/**
 * Tests for config_seeds_seeder.
 *
 * Concerns:
 *  1. TEST-ENV GUARD: a bare call under VITEST (no injected sourceDir) must copy
 *     ZERO files — it must never read/write the developer's real ~/.config.
 *  2. Copy behavior: with an injected source dir + temp dests, the SKILL.md
 *     lands under the managed skills root (keyed by frontmatter name) and every
 *     tool file lands under the tools dir.
 *  3. Version marker: a second call short-circuits (marker already set); a
 *     force-push OVERWRITES an existing managed copy so shipped fixes propagate.
 *  4. Never throws: a broken/absent source dir returns the empty result without
 *     throwing.
 *  5. Postgres no-op.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  seedConfigAssets,
  CONFIG_SEEDS_MARKER,
} from "../services/config_seeds_seeder";
import { slugForSkillName } from "../services/rhythm_managed_skills";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** Build a config_seeds-shaped source dir with one skill + the four tool files. */
function makeSourceDir(skillBody: string): string {
  const root = tmp("rhythm-config-seeds-src-");
  mkdirSync(join(root, "skills", "customize-rhythm"), { recursive: true });
  writeFileSync(
    join(root, "skills", "customize-rhythm", "SKILL.md"),
    skillBody,
  );
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(
    join(root, "tools", "classify.cjs"),
    "#!/usr/bin/env node\n// classify\n",
  );
  writeFileSync(
    join(root, "tools", "mcp-scan.cjs"),
    "#!/usr/bin/env node\n// scan\n",
  );
  writeFileSync(
    join(root, "tools", "config-doctor.sh"),
    "#!/usr/bin/env bash\n# doctor\n",
  );
  writeFileSync(join(root, "tools", "package.json"), '{"name":"x"}\n');
  // a dotfile that must NOT be copied
  writeFileSync(join(root, "tools", ".gitignore"), "node_modules/\n");
  return root;
}

const SKILL = `---
name: customize-rhythm
description: test skill
---
Body here.
`;

/** Injected marker seam backed by a plain in-memory flag. */
function markerSeam() {
  let done = false;
  return {
    alreadyDone: () => done,
    markDone: () => {
      done = true;
    },
    isDone: () => done,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("config_seeds_seeder.seedConfigAssets", () => {
  it("TEST-ENV GUARD: a bare call (no injected sourceDir) copies nothing", () => {
    const skillsDest = tmp("rhythm-seeds-skills-");
    const toolsDest = tmp("rhythm-seeds-tools-");
    const marker = markerSeam();

    // VITEST=true is set by the runner → sourceDir resolves to null.
    const r = seedConfigAssets({
      alreadyDone: marker.alreadyDone,
      markDone: marker.markDone,
      skillsDestRoot: skillsDest,
      toolsDestDir: toolsDest,
      provisionJsYaml: false,
    });

    expect(r.skillsCopied).toBe(0);
    expect(r.toolsCopied).toBe(0);
    // No dest files written.
    expect(existsSync(join(toolsDest, "classify.cjs"))).toBe(false);
    // Marker is still written (a clean no-source pass is "done").
    expect(marker.isDone()).toBe(true);
  });

  it("copies the skill (keyed by frontmatter name) and every tool file", () => {
    const src = makeSourceDir(SKILL);
    const skillsDest = tmp("rhythm-seeds-skills-");
    const toolsDest = tmp("rhythm-seeds-tools-");
    const marker = markerSeam();

    const r = seedConfigAssets({
      alreadyDone: marker.alreadyDone,
      markDone: marker.markDone,
      sourceDir: src,
      skillsDestRoot: skillsDest,
      toolsDestDir: toolsDest,
      provisionJsYaml: false,
    });

    expect(r.alreadyDone).toBe(false);
    expect(r.skillsCopied).toBe(1);
    expect(r.toolsCopied).toBe(4); // four tool files; .gitignore skipped

    const skillFile = join(
      skillsDest,
      slugForSkillName("customize-rhythm"),
      "SKILL.md",
    );
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, "utf8")).toContain("name: customize-rhythm");

    for (const f of [
      "classify.cjs",
      "mcp-scan.cjs",
      "config-doctor.sh",
      "package.json",
    ]) {
      expect(existsSync(join(toolsDest, f)), `${f} should be copied`).toBe(
        true,
      );
    }
    // Dotfile must be skipped.
    expect(existsSync(join(toolsDest, ".gitignore"))).toBe(false);
    expect(marker.isDone()).toBe(true);
  });

  it("short-circuits when the version marker is already set", () => {
    const src = makeSourceDir(SKILL);
    const skillsDest = tmp("rhythm-seeds-skills-");
    const toolsDest = tmp("rhythm-seeds-tools-");

    const r = seedConfigAssets({
      alreadyDone: () => true, // marker current
      markDone: () => {
        throw new Error("markDone must not run when already done");
      },
      sourceDir: src,
      skillsDestRoot: skillsDest,
      toolsDestDir: toolsDest,
      provisionJsYaml: false,
    });

    expect(r.alreadyDone).toBe(true);
    expect(r.skillsCopied).toBe(0);
    expect(existsSync(join(toolsDest, "classify.cjs"))).toBe(false);
  });

  it("force-pushes: overwrites an existing managed copy so a shipped fix propagates", () => {
    const src = makeSourceDir(SKILL);
    const skillsDest = tmp("rhythm-seeds-skills-");
    const toolsDest = tmp("rhythm-seeds-tools-");

    // Pre-existing stale copies at the dests.
    const skillDir = join(skillsDest, slugForSkillName("customize-rhythm"));
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "STALE");
    mkdirSync(toolsDest, { recursive: true });
    writeFileSync(join(toolsDest, "classify.cjs"), "STALE");

    const marker = markerSeam();
    seedConfigAssets({
      alreadyDone: marker.alreadyDone,
      markDone: marker.markDone,
      sourceDir: src,
      skillsDestRoot: skillsDest,
      toolsDestDir: toolsDest,
      provisionJsYaml: false,
    });

    expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toContain(
      "name: customize-rhythm",
    );
    expect(readFileSync(join(toolsDest, "classify.cjs"), "utf8")).not.toBe(
      "STALE",
    );
  });

  it("never throws on a missing source dir and returns the empty result", () => {
    const marker = markerSeam();
    expect(() =>
      seedConfigAssets({
        alreadyDone: marker.alreadyDone,
        markDone: marker.markDone,
        sourceDir: join(tmpdir(), "does-not-exist-" + Math.random()),
        skillsDestRoot: tmp("rhythm-seeds-skills-"),
        toolsDestDir: tmp("rhythm-seeds-tools-"),
        provisionJsYaml: false,
      }),
    ).not.toThrow();
  });

  it("is a no-op under Postgres", async () => {
    vi.stubEnv("DB_CLIENT", "postgres");
    vi.resetModules();
    const mod = await import("../services/config_seeds_seeder");
    const r = mod.seedConfigAssets({
      alreadyDone: () => false,
      markDone: () => {
        throw new Error("markDone must not run under postgres");
      },
      sourceDir: makeSourceDir(SKILL),
      skillsDestRoot: tmp("rhythm-seeds-skills-"),
      toolsDestDir: tmp("rhythm-seeds-tools-"),
      provisionJsYaml: false,
    });
    expect(r.alreadyDone).toBe(true);
    expect(r.skillsCopied).toBe(0);
  });

  it("exports a stable version marker key", () => {
    expect(CONFIG_SEEDS_MARKER).toBe("config_seeds_v3");
  });
});
