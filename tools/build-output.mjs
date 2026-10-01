import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

async function exists(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if ((await exists(current))?.isSymbolicLink())
      throw new Error(`Build output cannot traverse a symlink: ${current}`);
    if (path.dirname(current) === current) break;
  }
}

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Build output contains a symlink: ${relative}`);
    if (entry.isDirectory())
      files.push(...(await filesIn(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported build output entry: ${relative}`);
  }
  return files;
}

export async function validateOutputDirectory(projectRoot, directory) {
  const root = path.resolve(projectRoot);
  const output = path.resolve(root, directory);
  if (within(output, root))
    throw new Error("Build output must not be the project root or its parent.");
  for (const protectedPath of [
    "src",
    "images",
    "fonts",
    ".well-known",
    "tools",
    "test",
    "node_modules",
    ".git",
    ".cache",
  ]) {
    if (within(path.join(root, protectedPath), output))
      throw new Error(`Build output would overwrite ${protectedPath}.`);
  }
  await noLinks(output);
  const info = await exists(output);
  if (info && !info.isDirectory()) throw new Error("Build output must be a directory.");
  return output;
}

// Compile and copy everything privately first. Publication replaces assets
// before HTML, and rolls back changed files if publication itself fails.
export async function publishBuild({
  projectRoot,
  outputDirectory,
  retainAssets = false,
  prepare,
}) {
  const output = await validateOutputDirectory(projectRoot, outputDirectory);
  const manifestRoot = path.join(projectRoot, ".cache", "build-outputs");
  await noLinks(manifestRoot);
  const key = createHash("sha256").update(output).digest("hex");
  const manifestPath = path.join(manifestRoot, `${key}.json`);
  let previous;
  try {
    previous = JSON.parse(await readFile(manifestPath, "utf8")).files;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const existing = (await exists(output)) ? await filesIn(output) : [];
  if (!previous && existing.length && output !== path.join(projectRoot, "dist")) {
    throw new Error("An explicit --outdir must be empty or a previous output of this project.");
  }
  // A legacy dist has no ownership manifest. Replace this build's known
  // targets, but do not delete unrelated pre-existing contents.
  previous ??= [];
  const safeFile = (relative) => {
    if (!relative || path.isAbsolute(relative) || !within(output, path.resolve(output, relative))) {
      throw new Error(`Unsafe build output path: ${relative}`);
    }
    return path.join(output, relative);
  };
  previous.forEach(safeFile);
  const scratchParent = path.join(path.dirname(output), ".cache");
  await noLinks(scratchParent);
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchParent, "babel-build-"));
  const payload = path.join(scratch, "payload");
  const backup = path.join(scratch, "previous");
  const changed = [];
  const backedUp = new Set();
  let preserveScratch = false;
  try {
    await mkdir(payload);
    await prepare(payload);
    const current = await filesIn(payload);
    const keep = new Set(current);
    if (retainAssets) {
      for (const file of previous)
        if (/\.[a-f0-9]{8}\.(?:js|css|webp|glb)$/.test(file)) keep.add(file);
    }
    const stale = previous.filter((file) => !keep.has(file));
    // Complete backups before the first visible write. Never touch an output
    // symlink, including one introduced since the last successful build.
    for (const relative of new Set([...current, ...stale])) {
      const target = safeFile(relative);
      await noLinks(target);
      if (await exists(target)) {
        const saved = path.join(backup, relative);
        await mkdir(path.dirname(saved), { recursive: true });
        await copyFile(target, saved);
        backedUp.add(relative);
      }
    }
    await mkdir(output, { recursive: true });
    const ordered = current.sort(
      (a, b) => Number(a.endsWith(".html")) - Number(b.endsWith(".html")) || a.localeCompare(b),
    );
    for (const relative of ordered) {
      const target = safeFile(relative);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(path.join(payload, relative), target);
      changed.push(relative);
    }
    for (const relative of stale) {
      await rm(safeFile(relative), { force: true });
      changed.push(relative);
    }
    await mkdir(manifestRoot, { recursive: true });
    const nextManifest = `${manifestPath}.${path.basename(scratch)}.tmp`;
    await writeFile(nextManifest, JSON.stringify({ files: [...keep] }));
    await rename(nextManifest, manifestPath);
  } catch (error) {
    const rollbackErrors = [];
    for (const relative of changed.reverse()) {
      try {
        if (backedUp.has(relative)) await rename(path.join(backup, relative), safeFile(relative));
        else await rm(safeFile(relative), { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      preserveScratch = true;
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Build failed and output rollback was incomplete; recovery files retained at ${scratch}.`,
      );
    }
    throw error;
  } finally {
    if (
      path.dirname(scratch) !== scratchParent ||
      !path.basename(scratch).startsWith("babel-build-")
    ) {
      throw new Error("Refusing to remove an unexpected staging directory.");
    }
    if (!preserveScratch) await rm(scratch, { recursive: true, force: true });
  }
}
