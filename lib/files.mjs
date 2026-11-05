import path from "node:path";
import { randomUUID } from "node:crypto";
import { httpError } from "./auth.mjs";
import { imageMime } from "./media.mjs";

export const UPLOAD_LIMIT = 25 * 1024 * 1024;
// Keep each native RPC below the Codex API message limits.
const TRANSFER_CHUNK = 2 * 1024 * 1024;
const script = `import os,sys,json,shutil,tempfile,zipfile
c=json.loads(sys.argv[1]);root=os.path.realpath(c['root'])
def target(value,allow_root=False):
 p=os.path.abspath(os.path.join(root,value));real=os.path.realpath(p)
 if not (real==root or real.startswith(root+os.sep)) or (real==root and not allow_root): raise ValueError('Der Pfad muss innerhalb des Projekts liegen.')
 return p
source=target(c.get('path',''),c['op'] in ['stat','download'])
op=c['op'];result={}
if op in ['delete','move']:
 real=os.path.realpath(source)
 if any(os.path.realpath(p)==real or os.path.realpath(p).startswith(real+os.sep) for p in c.get('protected',[])): raise ValueError('Dieser Ordner enthält ein separat verwaltetes Projekt.')
if op=='stat':
 st=os.stat(source);result={'path':source,'size':st.st_size,'directory':os.path.isdir(source)}
elif op in ['file','folder']:
 if os.path.lexists(source): raise ValueError('Dieser Name existiert bereits.')
 if op=='folder': os.makedirs(source)
 else:
  os.makedirs(os.path.dirname(source),exist_ok=True)
  with open(source,'x',encoding='utf-8') as f: f.write(c.get('text',''))
elif op=='move':
 dest=target(c['destination'])
 if os.path.lexists(dest): raise ValueError('Das Ziel existiert bereits.')
 if dest.startswith(source+os.sep): raise ValueError('Ein Ordner kann nicht in sich selbst verschoben werden.')
 os.makedirs(os.path.dirname(dest),exist_ok=True);os.rename(source,dest);result={'path':dest}
elif op=='delete':
 if c.get('confirm')!=os.path.basename(source): raise ValueError('Bitte den Dateinamen zum Löschen bestätigen.')
 if os.path.isdir(source) and not os.path.islink(source): shutil.rmtree(source)
 else: os.unlink(source)
elif op=='download':
 if not os.path.isdir(source):
  size=os.path.getsize(source)
  if size>50*1024*1024: raise ValueError('Downloads sind auf 50 MB begrenzt.')
  result={'path':source,'size':size,'name':os.path.basename(source),'temporary':False}
 else:
  fd,name=tempfile.mkstemp(prefix='codex-web-download-',suffix='.zip');os.close(fd)
  try:
   count=0;total=0
   with zipfile.ZipFile(name,'w',zipfile.ZIP_DEFLATED) as z:
    for current,dirs,files in os.walk(source,followlinks=False):
     dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(current,d))]
     for f in files:
      p=os.path.join(current,f)
      if os.path.islink(p): continue
      total+=os.path.getsize(p);count+=1
      if total>100*1024*1024 or count>5000: raise ValueError('Dieser Ordner ist zu groß für einen ZIP-Download (100 MB / 5.000 Dateien).')
      z.write(p,os.path.relpath(p,source))
   if os.path.getsize(name)>50*1024*1024: raise ValueError('Das ZIP-Archiv überschreitet 50 MB.')
   result={'path':name,'size':os.path.getsize(name),'name':os.path.basename(source)+'.zip','temporary':True}
  except:
   os.unlink(name);raise
else: raise ValueError('Unbekannte Dateiaktion.')
print(json.dumps(result))`;

export async function fileAction(projects, id, input) {
  const project = projects.find(id);
  if (typeof input.path !== "string" || input.path.length > 4096)
    throw httpError(400, "Bitte einen gültigen Projektpfad angeben.");
  const target = path.posix.resolve(project.path, input.path);
  if (["delete", "move"].includes(input.op)) {
    for (const other of projects.data.projects)
      if (
        other.id !== id &&
        (other.path === target || other.path.startsWith(target + "/"))
      )
        throw httpError(
          409,
          "Dieser Ordner enthält ein separat verwaltetes Projekt.",
        );
  }
  try {
    const result = await projects.command(
      [
        "python3",
        "-c",
        script,
        JSON.stringify({
          ...input,
          root: project.path,
          protected: projects.data.projects
            .filter((p) => p.id !== id)
            .map((p) => p.path),
        }),
      ],
      projects.home,
      60000,
    );
    return JSON.parse(result.stdout);
  } catch (error) {
    const last = error.message
      .trim()
      .split("\n")
      .at(-1)
      .replace(
        /^(?:ValueError|FileNotFoundError|PermissionError|FileExistsError):\s*/,
        "",
      );
    throw httpError(error.status || 400, last);
  }
}
export async function uploadFile(projects, id, name, content, directory) {
  const project = projects.find(id);
  const basename = path.posix
    .basename((name || "Datei").replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f]/g, "_")
    .slice(0, 200);
  if (!basename || basename === "." || basename === "..")
    throw httpError(400, "Ungültiger Dateiname.");
  if (content.length > UPLOAD_LIMIT)
    throw httpError(413, "Eine Datei darf höchstens 25 MB groß sein.");
  const parent =
    directory || path.posix.join(".codex-web/uploads", randomUUID());
  const resolved = await fileAction(projects, id, {
    op: "stat",
    path: directory || "",
  });
  if (directory && !resolved.directory)
    throw httpError(400, "Das Upload-Ziel ist kein Ordner.");
  if (!directory)
    await fileAction(projects, id, { op: "folder", path: parent });
  const target = path.posix.join(
    path.posix.resolve(project.path, parent),
    basename,
  );
  // Exclusive creation prevents silently overwriting an existing project file.
  await fileAction(projects, id, { op: "file", path: target, text: "" });
  let staging;
  try {
    if (content.length <= TRANSFER_CHUNK) {
      await projects.bridge.call("fs/writeFile", {
        path: target,
        dataBase64: content.toString("base64"),
      });
    } else {
      const created = await projects.command([
        "python3",
        "-c",
        "import tempfile,json;print(json.dumps(tempfile.mkdtemp(prefix='codex-web-upload-')))",
      ]);
      staging = JSON.parse(created.stdout);
      let count = 0;
      for (let offset = 0; offset < content.length; offset += TRANSFER_CHUNK) {
        await projects.bridge.call("fs/writeFile", {
          path: path.posix.join(staging, String(count++)),
          dataBase64: content
            .subarray(offset, offset + TRANSFER_CHUNK)
            .toString("base64"),
        });
      }
      await projects.command([
        "python3",
        "-c",
        "import sys,os,shutil\nwith open(sys.argv[1],'wb') as out:\n for i in range(int(sys.argv[3])):\n  with open(os.path.join(sys.argv[2],str(i)),'rb') as part: shutil.copyfileobj(part,out)",
        target,
        staging,
        String(count),
      ]);
    }
  } catch (error) {
    try {
      await fileAction(projects, id, {
        op: "delete",
        path: target,
        confirm: basename,
      });
    } catch {}
    throw error;
  } finally {
    if (staging) {
      try {
        await projects.bridge.call("fs/remove", {
          path: staging,
          recursive: true,
          force: true,
        });
      } catch {}
    }
  }
  return {
    path: target,
    name: basename,
    size: content.length,
    mime: imageMime(target) || "application/octet-stream",
    image: /\.(png|jpe?g|webp|gif)$/i.test(target),
  };
}
export async function downloadFile(projects, id, filename) {
  const info = await fileAction(projects, id, {
    op: "download",
    path: filename,
  });
  try {
    let content;
    if (info.size <= TRANSFER_CHUNK) {
      const result = await projects.bridge.call("fs/readFile", {
        path: info.path,
      });
      content = Buffer.from(result.dataBase64, "base64");
    } else {
      const chunks = [];
      for (let offset = 0; offset < info.size; offset += TRANSFER_CHUNK) {
        const result = await projects.command(
          [
            "python3",
            "-c",
            "import sys,base64\nwith open(sys.argv[1],'rb') as f:\n f.seek(int(sys.argv[2]));print(base64.b64encode(f.read(int(sys.argv[3]))).decode())",
            info.path,
            String(offset),
            String(TRANSFER_CHUNK),
          ],
          projects.home,
          20000,
          4 * 1024 * 1024,
        );
        const chunk = Buffer.from(result.stdout.trim(), "base64");
        if (chunk.length !== Math.min(TRANSFER_CHUNK, info.size - offset))
          throw httpError(
            409,
            "Die Datei hat sich beim Herunterladen geändert. Bitte erneut herunterladen.",
          );
        chunks.push(chunk);
      }
      content = Buffer.concat(chunks);
    }
    return {
      name: info.name,
      mime: info.temporary
        ? "application/zip"
        : imageMime(info.path) || "application/octet-stream",
      content,
    };
  } finally {
    if (info.temporary)
      await projects.bridge.call("fs/remove", {
        path: info.path,
        recursive: false,
        force: true,
      });
  }
}
