#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildFileCatalog } from './core/file-catalog.mjs';
import { compileArchive, resolveSourceFiles } from './core/compiler.mjs';
import { parseLegacyArchive } from './core/legacy-parser.mjs';
import { loadSource } from './core/source-loader.mjs';
import { writeMigratedSource } from './core/migration-writer.mjs';
import { buildStaticSite } from './core/site-builder.mjs';
import { writeJson } from './core/jsonc.mjs';
import { asBoolean, copyDirectory, ensureDirectory, parseArguments } from './core/util.mjs';

function usage() {
  console.log(`stairs2line archive tool

Commands:
  migrate  --input <legacy.cshtml.txt> --output <source-directory>
  resolve  --source <source-directory> --media-root <media-directory> --output <resolved-source-directory>
  validate --source <source-directory> [--media-root <media-directory>] [--output <validation.json>]
  build    --source <source-directory> --output <site-directory> [--media-root <media-directory>]
           [--base-path /repository/] [--site-origin https://example.com]
           [--preview-placeholders] [--copy-media]
`);
}

function cleanEntity(value) {
  if (Array.isArray(value)) return value.map(cleanEntity);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, item]) => [key, cleanEntity(item)])
  );
}

async function writeResolvedCollections(source, sourceRoot, outputRoot) {
  await fs.rm(outputRoot, { recursive: true, force: true });
  await copyDirectory(sourceRoot, outputRoot);

  const groups = new Map();
  for (const [property, entities] of [['posts', source.posts], ['artworks', source.artworks]]) {
    for (const entity of entities) {
      const sourceFile = entity.__source;
      if (!sourceFile) continue;
      const relative = path.relative(sourceRoot, sourceFile);
      const key = `${property}|${relative}`;
      if (!groups.has(key)) groups.set(key, { property, relative, entities: [] });
      groups.get(key).entities.push(cleanEntity(entity));
    }
  }

  for (const group of groups.values()) {
    const destination = path.join(outputRoot, group.relative);
    await ensureDirectory(path.dirname(destination));
    await writeJson(destination, { [group.property]: group.entities }, 'Resolved physical file paths and explicit media relationships.');
  }
}

async function migrateCommand(args) {
  if (!args.input || !args.output) throw new Error('migrate requires --input and --output.');
  const migration = await parseLegacyArchive(path.resolve(args.input));
  await writeMigratedSource(path.resolve(args.output), migration);
  console.log(JSON.stringify({ output: path.resolve(args.output), ...migration.report, inferredLinks: undefined }, null, 2));
}

async function resolveCommand(args) {
  if (!args.source || !args['media-root'] || !args.output) {
    throw new Error('resolve requires --source, --media-root, and --output.');
  }
  const sourceRoot = path.resolve(args.source);
  const mediaRoot = path.resolve(args['media-root']);
  const source = await loadSource(sourceRoot);
  const knownPostIds = source.posts.map((post) => ({
    key: post.key ?? `${post.platform}:${post.id}`,
    platform: post.platform,
    id: String(post.id)
  }));
  const catalog = await buildFileCatalog(mediaRoot, {
    includeDirectories: source.site.mediaDirectories,
    knownPostIds
  });
  resolveSourceFiles(source, catalog);
  await writeResolvedCollections(source, sourceRoot, path.resolve(args.output));
  const compilation = await compileArchive(source, { mediaRoot });
  await writeJson(path.join(path.resolve(args.output), 'resolve-report.json'), {
    summary: compilation.manifest.summary,
    issues: compilation.issues
  }, 'Result of resolving legacy IDs against the physical media directory.');
  console.log(JSON.stringify(compilation.manifest.summary, null, 2));
}

async function validateCommand(args) {
  if (!args.source) throw new Error('validate requires --source.');
  const source = await loadSource(path.resolve(args.source));
  const compilation = await compileArchive(source, {
    mediaRoot: args['media-root'] ? path.resolve(args['media-root']) : null,
    previewPlaceholders: false
  });
  const report = { summary: compilation.manifest.summary, issues: compilation.issues };
  if (args.output) await writeJson(path.resolve(args.output), report);
  console.log(JSON.stringify(report.summary, null, 2));
  for (const issue of compilation.issues) {
    console.log(`${issue.severity.toUpperCase()} ${issue.code} ${issue.entityType}:${issue.entityId}`);
  }
  if (report.summary.errorCount > 0) process.exitCode = 1;
}

async function buildCommand(args) {
  if (!args.source || !args.output) throw new Error('build requires --source and --output.');
  const source = await loadSource(path.resolve(args.source));
  if (args['base-path']) source.site.basePath = args['base-path'];
  if (args['site-origin']) source.site.origin = args['site-origin'];
  const previewPlaceholders = asBoolean(args['preview-placeholders']);
  const mediaRoot = args['media-root'] ? path.resolve(args['media-root']) : null;
  const compilation = await compileArchive(source, { mediaRoot, previewPlaceholders });
  if (compilation.manifest.summary.errorCount > 0 && !previewPlaceholders && !asBoolean(args['allow-errors'])) {
    for (const issue of compilation.issues) {
      console.error(`${issue.severity.toUpperCase()} ${issue.code} ${issue.entityType}:${issue.entityId}`);
    }

    throw new Error(`Build stopped because validation found ${compilation.manifest.summary.errorCount} errors.`);
  }
  await buildStaticSite(compilation, source, path.resolve(args.output), {
    mediaRoot,
    copyMedia: asBoolean(args['copy-media'])
  });
  console.log(JSON.stringify({ output: path.resolve(args.output), ...compilation.manifest.summary }, null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArguments(rest);
  if (!command || ['help', '--help', '-h'].includes(command)) {
    usage();
    return;
  }
  if (command === 'migrate') await migrateCommand(args);
  else if (command === 'resolve') await resolveCommand(args);
  else if (command === 'validate') await validateCommand(args);
  else if (command === 'build') await buildCommand(args);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
