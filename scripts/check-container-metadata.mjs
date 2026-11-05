import { inspectPublicationData } from "./check-publication.mjs";

const sanitize = process.env.SANITIZE_METADATA === "true";
const repository = `${process.env.GH_REPOSITORY.toLowerCase()}-ui`;
if (process.env.WITHDRAW_PACKAGE === "true") {
  const [owner, name] = repository.split("/");
  const result = await fetch(`https://api.github.com/users/${owner}/packages/container/${name}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!result.ok) throw new Error(`Package withdrawal failed (${result.status}).`);
  console.log("Package withdrawn. Local images and running containers are unaffected.");
  process.exit(0);
}
const credentials = Buffer.from(`${process.env.GH_ACTOR}:${process.env.GH_TOKEN}`).toString("base64");
const response = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull${sanitize ? ",push" : ""}`, {
  headers: { Authorization: `Basic ${credentials}` },
});
if (!response.ok) throw new Error(`Registry authorization failed (${response.status}).`);
const { token } = await response.json();
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
};
async function get(resource) {
  const r = await fetch(`https://ghcr.io/v2/${repository}/${resource}`, { headers });
  if (!r.ok) throw new Error(`Registry read failed (${r.status}).`);
  if (resource.startsWith("manifests/")) manifestDigests.set(resource.slice(10), r.headers.get("Docker-Content-Digest"));
  return r.json();
}
const manifests = new Map();
const manifestDigests = new Map();
const seen = new Set();
const findings = [];
async function inspectManifest(reference) {
  if (seen.has(reference)) return;
  seen.add(reference);
  const manifest = await get(`manifests/${reference}`);
  manifests.set(reference, manifest);
  for (const child of manifest.manifests || []) await inspectManifest(child.digest);
  const metadata = [];
  if (manifest.config) metadata.push(manifest.config);
  for (const layer of manifest.layers || [])
    if (/in-toto|json/.test(layer.mediaType)) metadata.push(layer);
  for (const item of metadata) {
    const content = JSON.stringify(await get(`blobs/${item.digest}`))
      .replace(/\/home\/runner\//g, "/home/codex/")
      .replace(/git@github\.com:/g, "git:");
    findings.push(...inspectPublicationData(Buffer.from(content), `${reference}/${item.digest}`));
  }
}
const { tags } = await get("tags/list");
for (const tag of tags || []) await inspectManifest(tag);
console.log(JSON.stringify({ tags: tags?.length || 0, manifests: seen.size, findings }));
if (sanitize) {
  const obsolete = new Set();
  const retainedPlatforms = new Set();
  for (const tag of tags || []) {
    const index = manifests.get(tag);
    if (!index.manifests) continue;
    const platforms = index.manifests.filter((m) => m.platform?.os !== "unknown" && m.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest");
    if (!platforms.length) throw new Error("Refusing to remove all image platforms.");
    for (const p of platforms) retainedPlatforms.add(p.digest);
    if (platforms.length === index.manifests.length) continue;
    const original = manifestDigests.get(tag);
    if (!original) throw new Error("Original manifest digest unavailable.");
    obsolete.add(original);
    for (const m of index.manifests) if (!platforms.includes(m)) obsolete.add(m.digest);
    const clean = { ...index, manifests: platforms };
    const written = await fetch(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
      method: "PUT", headers: { ...headers, "Content-Type": index.mediaType }, body: JSON.stringify(clean),
    });
    if (!written.ok) throw new Error(`Clean manifest write failed (${written.status}).`);
    const verified = await get(`manifests/${tag}`);
    if (JSON.stringify(verified.manifests) !== JSON.stringify(platforms)) throw new Error("Manifest verification failed.");
  }
  for (const digest of retainedPlatforms) if (obsolete.has(digest)) throw new Error("Refusing to delete a retained platform.");
  const [owner, image] = repository.split("/");
  const apiHeaders = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" };
  const versions = [];
  for (let page = 1; ; page++) {
    const r = await fetch(`https://api.github.com/users/${owner}/packages/container/${image}/versions?per_page=100&page=${page}`, { headers: apiHeaders });
    if (!r.ok) throw new Error(`Package inventory unavailable (${r.status}).`);
    const entries = await r.json(); versions.push(...entries);
    if (entries.length < 100) break;
  }
  let removed = 0;
  for (const version of versions) if (obsolete.has(version.name)) {
    if (version.metadata?.container?.tags?.length) throw new Error("Refusing to delete a version that still has tags.");
    const r = await fetch(`https://api.github.com/users/${owner}/packages/container/${image}/versions/${version.id}`, { method: "DELETE", headers: apiHeaders });
    if (!r.ok) throw new Error(`Obsolete metadata deletion failed (${r.status}).`);
    removed++;
  }
  seen.clear(); findings.length = 0;
  for (const tag of tags || []) await inspectManifest(tag);
  console.log(JSON.stringify({ sanitizedTags: tags.length, removedMetadataVersions: removed, findings }));
}
process.exitCode = findings.length ? 1 : 0;
