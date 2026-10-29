"use strict";
/* ------------------------------------------------------------------
   Publisher – build & deploy to Crestron touch panels
   ------------------------------------------------------------------
   Builds a .ch5z per screen (the panel files + that screen's config.js
   + uploaded logo/background) with Crestron's ch5-cli and pushes it to
   the panel with `ch5-cli deploy` (SFTP, the panel's admin login).
   One job at a time; progress is kept in `status` for the admin page.
   ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { panelConfigJs } = require("./model");
const { log } = require("./util");

const PROJECT = "dsp-panel";

class Publisher {
  /* @param store    SiteStore
     @param rootDir  the panel files (project root)
     @param opts     { buildDir, binDir } – where to stage builds, where node_modules/.bin lives */
  constructor(store, rootDir, opts = {}) {
    this.store = store; this.root = rootDir;
    this.buildRoot = opts.buildDir || path.join(path.dirname(store.path), ".build");   // on disk, not /tmp (often a small tmpfs on a Pi)
    this.binDir = opts.binDir || path.join(path.dirname(store.path), "node_modules", ".bin");
    this.status = { running: false, startedAt: null, finishedAt: null, log: [], results: [] };
  }
  get running() { return this.status.running; }
  cliInstalled() { return fs.existsSync(path.join(path.dirname(this.binDir), "@crestron", "ch5-utilities-cli")); }
  plog(line) { this.status.log.push(line); if (this.status.log.length > 400) this.status.log.shift(); log("publish:", line); }
  cli() {
    const local = path.join(this.binDir, process.platform === "win32" ? "ch5-cli.cmd" : "ch5-cli");
    return fs.existsSync(local) ? { cmd: local, pre: [] } : { cmd: process.platform === "win32" ? "npx.cmd" : "npx", pre: ["--yes", "@crestron/ch5-utilities-cli"] };
  }
  run(args, opts) {
    const { cmd, pre } = this.cli();
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, [...pre, ...args], { cwd: opts.cwd, env: Object.assign({}, process.env, opts.env || {}), stdio: ["pipe", "pipe", "pipe"] });
      const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timed out after ${opts.timeoutMs / 1000} s`)); }, opts.timeoutMs || 300000);
      let tail = "";
      const onData = d => {
        const s = d.toString("utf8"); tail = (tail + s).slice(-2000);
        s.split(/\r?\n/).map(x => x.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()).filter(Boolean).forEach(x => this.plog("  " + x));
        if (opts.answers) { if (/sftp user/i.test(s)) child.stdin.write(opts.answers.user + "\n"); else if (/password/i.test(s)) child.stdin.write(opts.answers.password + "\n"); }   // if the CLI prompts anyway
      };
      child.stdout.on("data", onData); child.stderr.on("data", onData);
      child.on("error", e => { clearTimeout(t); reject(new Error(e.code === "ENOENT" ? `${cmd} not found – install Node/npm on the bridge host` : e.message)); });
      child.on("close", (code, signal) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code != null ? code : signal}: ${tail.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim().split("\n").slice(-3).join(" | ")}`)); });
    });
  }
  /* the config.js built into a screen's archive (transport pinned to this bridge, token included) */
  configFor(panel) {
    const s = this.store;
    return panelConfigJs(s.site, panel, true, { theme: s.theme(), publicUrl: s.publicUrl(), requireToken: s.security().requireToken });
  }
  /* Stage the panel files for one screen and archive them → returns the .ch5z path. */
  async buildArchive(panel) {
    // <build>/<id>/src = the panel files, <build>/<id>/dist = the archive. Kept apart: ch5-cli copies the
    // source dir into <out>/temp first, so an output dir inside the source recurses until the disk is full.
    const dir = path.join(this.buildRoot, panel.id), src = path.join(dir, "src");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(src, { recursive: true });
    const skip = new Set(["bridge", "node_modules", "dist", "docs", "test", ".git", "LICENSE", "README.md", "cr-com-lib.js", "webxpanel.js"]);   // only the panel files
    const wanted = f => !(path.basename(f).startsWith(".") || /\.(smw|bundle|c3p|md)$/i.test(f));
    for (const e of fs.readdirSync(this.root)) if (!skip.has(e) && wanted(e)) fs.cpSync(path.join(this.root, e), path.join(src, e), { recursive: true, filter: wanted });
    fs.writeFileSync(path.join(src, "js", "config.js"), this.configFor(panel));
    const theme = this.store.site.theme || {};
    for (const k of ["logo", "background"]) { const f = this.store.customFile(theme[k]); if (f && fs.existsSync(f)) { fs.mkdirSync(path.join(src, "custom"), { recursive: true }); fs.copyFileSync(f, path.join(src, "custom", path.basename(f))); } }
    this.plog(`${panel.name}: building archive (zones: ${panel.zones === "*" ? "all" : panel.zones.join(", ")}; bridge ${this.store.publicUrl()})`);
    await this.run(["archive", "-p", PROJECT, "-d", "src", "-o", "dist"], { cwd: dir, timeoutMs: 180000 });
    const out = path.join(dir, "dist", PROJECT + ".ch5z");
    if (!fs.existsSync(out)) throw new Error("archive produced no " + PROJECT + ".ch5z");
    return out;
  }
  /* Build and deploy to the given screen ids (null = all with an IP). Returns at once; progress in `status`. */
  publish(ids) {
    if (this.status.running) throw new Error("a publish job is already running");
    const list = (this.store.site.panels || []).filter(p => (!ids || ids.includes(p.id)));
    if (!list.length) throw new Error("no screens selected");
    Object.assign(this.status, { running: true, startedAt: Date.now(), finishedAt: null, log: [], results: [] });
    (async () => {
      for (const p of list) {
        const r = { id: p.id, name: p.name, host: p.host, ok: false, error: "" };
        try {
          if (!p.host) throw new Error("no IP address set");
          const file = await this.buildArchive(p);
          this.plog(`${p.name}: deploying to ${p.host} as ${p.user || "admin"} …`);
          // NB: in "deploy" -p means "prompt for credentials" (not project name) – never pass it here
          await this.run(["deploy", "-H", p.host, "-t", "touchscreen", file],
            { cwd: path.dirname(file), timeoutMs: 420000, env: { CH5CLI_DEPLOY_USER: p.user || "admin", CH5CLI_DEPLOY_PW: p.password || "" }, answers: { user: p.user || "admin", password: p.password || "" } });
          r.ok = true; this.plog(`${p.name}: ✓ published to ${p.host}`);
        } catch (e) { r.error = e.message; this.plog(`${p.name}: ✗ ${e.message}`); }
        this.status.results.push(r);
      }
      this.status.running = false; this.status.finishedAt = Date.now();
      this.plog(`done: ${this.status.results.filter(r => r.ok).length}/${this.status.results.length} screens published`);
    })();
  }
}

module.exports = { Publisher, PROJECT };
