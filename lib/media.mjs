import path from "node:path";
import { createHash } from "node:crypto";
import { httpError } from "./auth.mjs";

export const imageMime = (filename) =>
  ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
  })[path.posix.extname(filename).toLowerCase()];
const scanScript = `import os,sys,json,re,hashlib,collections
cfg=json.loads(sys.argv[1]); result=[]; seen=set()
excluded=[os.path.realpath(p) for p in cfg.get('excluded',[])]
project_root=os.path.realpath(cfg['sources'][0]['path'])
def blocked(p):
 p=os.path.realpath(p)
 parts=os.path.relpath(p,project_root).split(os.sep)
 internal=parts[0]!='..' and any(part in skip for part in parts[:-1])
 return internal or any(p==e or p.startswith(e+os.sep) for e in excluded)
skip={'.git','node_modules','.venv','venv','__pycache__','.next','.cache','.data','.codex','playwright-report'}
extensions={'.png','.jpg','.jpeg','.webp','.gif','.avif','.bmp'}
for source in cfg['sources']:
 root=source['path']
 if not os.path.isdir(root) or (not source['generated'] and blocked(root)): continue
 for current,dirs,files in os.walk(root,followlinks=False):
  depth=os.path.relpath(current,root).count(os.sep)
  dirs[:]=sorted(d for d in dirs if d not in skip and not os.path.islink(os.path.join(current,d)) and (source['generated'] or not blocked(os.path.join(current,d)))) if depth<8 else []
  for name in sorted(files):
   if os.path.splitext(name)[1].lower() not in extensions: continue
   filename=os.path.join(current,name)
   if not source['generated'] and blocked(filename): continue
   if filename in seen: continue
   try: st=os.stat(filename)
   except OSError: continue
   seen.add(filename); relative=os.path.relpath(filename,root)
   screenshot=bool(re.search(r'screenshot|screen.?shot|test-results|playwright|bildschirm|aufnahme|(^|/)screens/',relative,re.I))
   category='screenshots' if screenshot else 'generated' if source['generated'] or re.search(r'generated|imagegen',relative,re.I) else 'project'
   result.append({'path':filename,'name':name,'relativePath':relative,'category':category,'size':st.st_size,'modifiedAt':int(st.st_mtime*1000),'threadId':source.get('threadId')})
   if len(result)>=2000: break
  if len(result)>=2000: break
 if len(result)>=2000: break
for entry in cfg.get('files',[]):
 filename=entry['path']
 if filename in seen or not os.path.isfile(filename) or os.path.splitext(filename)[1].lower() not in extensions or (not entry.get('generated') and blocked(filename)): continue
 try: st=os.stat(filename)
 except OSError: continue
 seen.add(filename); screenshot=bool(re.search(r'screenshot|screen.?shot|test-results|playwright|capture|bildschirm|aufnahme',filename,re.I))
 result.append({'path':filename,'name':os.path.basename(filename),'relativePath':filename,'category':'screenshots' if screenshot else 'generated' if 'generated_images' in filename or 'imagegen' in filename else 'project','size':st.st_size,'modifiedAt':int(st.st_mtime*1000),'threadId':entry['threadId']})
 if len(result)>=2000: break
truncated=len(result)>=2000
sizes=collections.Counter(image['size'] for image in result)
unique={};priority={'generated':0,'screenshots':1,'project':2}
for image in sorted(result,key=lambda i:(priority[i['category']],len(i['relativePath'].split(os.sep)),len(i['relativePath']),i['path'])):
 key=image['path']
 if sizes[image['size']]>1:
  try:
   before=os.stat(image['path']);digest=hashlib.sha256()
   with open(image['path'],'rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''): digest.update(chunk)
   after=os.stat(image['path'])
   if (before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_size,after.st_mtime_ns,after.st_ctime_ns):
    image['contentHash']=digest.hexdigest();key=image['contentHash']
  except OSError: pass
 if key in unique:
  unique[key]['copies'].append(image['path'])
  if not unique[key].get('threadId') and image.get('threadId'): unique[key]['threadId']=image['threadId']
 else:
  image['copies']=[image['path']];unique[key]=image
print(json.dumps({'images':list(unique.values()),'truncated':truncated}))`;

export async function projectMedia(projects, id) {
  const project = projects.find(id);
  const [active, archived] = await Promise.all([
    projects.allThreads(false),
    projects.allThreads(true),
  ]);
  const threads = [...active, ...archived].filter((t) => {
    const owner = projects.data.threadProjects[t.id];
    return owner ? owner === id : t.cwd === project.path;
  });
  const codexHome =
    projects.bridge.status.info?.codexHome ||
    path.posix.join(projects.home, ".codex");
  const sources = [
    { path: project.path, generated: false },
    ...threads.map((t) => ({
      path: path.posix.join(codexHome, "generated_images", t.id),
      generated: true,
      threadId: t.id,
    })),
  ];
  const excluded = [
    codexHome,
    ...projects.data.projects
      .filter(
        (p) =>
          p.id !== id &&
          !project.path.startsWith(p.path.replace(/\/$/, "") + "/"),
      )
      .map((p) => p.path),
  ];
  const files = [];
  for (const thread of threads) {
    let cached = projects.data.mediaIndex[thread.id];
    if (
      !cached ||
      cached.version !== 2 ||
      cached.updatedAt !== thread.updatedAt
    ) {
      const paths = new Set();
      let complete = true;
      let cursor;
      do {
        let page;
        try {
          page = await projects.bridge.call("thread/turns/list", {
            threadId: thread.id,
            limit: 100,
            itemsView: "full",
            ...(cursor ? { cursor } : {}),
          });
        } catch {
          complete = false;
          break;
        }
        const walk = (value, depth = 0) => {
          if (depth > 10 || value == null) return;
          if (typeof value === "string") {
            if (
              !/^(?:https?:|data:)/.test(value) &&
              !value.includes("\n") &&
              imageMime(value)
            ) {
              let filename = value.replace(/^(?:sandbox:|file:\/\/)/, "");
              try {
                filename = decodeURIComponent(filename);
              } catch {}
              paths.add(
                path.posix.resolve(thread.cwd || project.path, filename),
              );
            }
            for (const match of value.matchAll(
              /(?:sandbox:|file:\/\/)?(\/[^\s<>"'`\]\)]+\.(?:png|jpe?g|gif|webp|avif|bmp))/gi,
            ))
              paths.add(match[1]);
          } else if (Array.isArray(value))
            for (const item of value) walk(item, depth + 1);
          else if (typeof value === "object")
            for (const [key, item] of Object.entries(value))
              if (
                ![
                  "result",
                  "dataBase64",
                  "encryptedContent",
                  "command",
                  "arguments",
                ].includes(key) ||
                typeof item !== "string"
              )
                walk(item, depth + 1);
        };
        walk(page.data);
        cursor = page.nextCursor;
      } while (cursor);
      cached = { version: 2, updatedAt: thread.updatedAt, paths: [...paths] };
      if (complete) projects.data.mediaIndex[thread.id] = cached;
    }
    for (const filename of cached.paths) {
      const generatedRoot = path.posix.join(codexHome, "generated_images");
      const generated = filename.startsWith(generatedRoot + "/");
      if (
        generated &&
        !filename.startsWith(path.posix.join(generatedRoot, thread.id) + "/")
      )
        continue;
      files.push({ path: filename, threadId: thread.id, generated });
    }
  }
  await projects.save();
  const result = await projects.command(
    ["python3", "-c", scanScript, JSON.stringify({ sources, files, excluded })],
    projects.home,
    60000,
  );
  const parsed = JSON.parse(result.stdout);
  return {
    projectId: id,
    ...parsed,
    images: parsed.images
      .map((item) => ({
        ...item,
        id: createHash("sha256").update(item.path).digest("hex").slice(0, 20),
      }))
      .sort((a, b) => b.modifiedAt - a.modifiedAt),
  };
}
const missing = (error) =>
  /no such file|not found|does not exist|os error 2/i.test(error.message);
const imageHistories = new WeakMap();
async function historyImage(bridge, threadId, itemId) {
  let histories = imageHistories.get(bridge);
  if (!histories) imageHistories.set(bridge, (histories = new Map()));
  let cached = histories.get(threadId);
  if (!cached || Date.now() - cached.at > 30000) {
    const request = (async () => {
      const images = new Map();
      let cursor;
      do {
        const page = await bridge.call("thread/turns/list", {
          threadId,
          itemsView: "full",
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const turn of page.data)
          for (const item of turn.items || [])
            if (item.type === "imageGeneration" || item.type === "imageView")
              images.set(item.id, item);
        cursor = page.nextCursor;
      } while (cursor);
      return images;
    })();
    cached = { at: Date.now(), request };
    histories.set(threadId, cached);
    if (histories.size > 20) histories.delete(histories.keys().next().value);
    request.catch(() => {
      if (histories.get(threadId) === cached) histories.delete(threadId);
    });
  }
  const item = (await cached.request).get(itemId);
  if (!item) histories.delete(threadId);
  return item;
}
async function fileImage(bridge, filename) {
  const mime = imageMime(filename || "");
  if (!mime || !path.posix.isAbsolute(filename))
    throw httpError(400, "Ungültiger Bildpfad.");
  const result = await bridge.call("fs/readFile", { path: filename });
  if (result.dataBase64.length > 28 * 1024 * 1024)
    throw httpError(413, "Das Bild ist zu groß für die Vorschau.");
  return { content: Buffer.from(result.dataBase64, "base64"), mime };
}
export async function readImage(bridge, filename, { threadId, itemId } = {}) {
  if (filename) {
    try {
      return await fileImage(bridge, filename);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  if (
    threadId &&
    itemId &&
    /^[\w-]{1,200}$/.test(threadId) &&
    /^[\w-]{1,200}$/.test(itemId)
  ) {
    const home = bridge.status.info?.codexHome;
    if (home) {
      try {
        return await fileImage(
          bridge,
          path.posix.join(home, "generated_images", threadId, itemId + ".png"),
        );
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    const item = await historyImage(bridge, threadId, itemId);
    if (item?.result) {
      const match = item.result.match(
        /^data:(image\/(?:png|jpeg|webp|gif|avif|bmp));base64,(.*)$/s,
      );
      const data = match ? match[2] : item.result;
      if (data.length > 28 * 1024 * 1024)
        throw httpError(413, "Das Bild ist zu groß für die Vorschau.");
      return {
        content: Buffer.from(data, "base64"),
        mime: match?.[1] || "image/png",
      };
    }
    if (item?.savedPath || item?.path) {
      try {
        return await fileImage(bridge, item.savedPath || item.path);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  }
  throw httpError(404, "Dieses Bild ist auf der KI-VM nicht mehr verfügbar.");
}
