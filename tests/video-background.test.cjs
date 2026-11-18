const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) {
    this.listeners.get(name)?.delete(callback);
  }
  emit(name, event = {}) {
    for (const callback of [...(this.listeners.get(name) || [])])
      callback(event);
  }
}

function setup({
  frameCallbacks = true,
  blocked = false,
  reduced = false,
  readyState = 0,
} = {}) {
  const frames = new Map(),
    timers = new Map();
  let nextId = 0;
  const videos = [0, 1].map((index) => {
    const video = new Events();
    const classes = new Set(index === 0 ? ["is-active"] : []);
    Object.assign(video, {
      classes,
      paused: true,
      readyState,
      duration: 10,
      currentTime: 0,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      async play() {
        if (blocked) throw new Error("Autoplay blocked");
        this.paused = false;
        this.emit("play");
      },
      pause() {
        if (this.paused) return;
        this.paused = true;
        this.emit("pause");
      },
      callbacks: new Map(),
      presentFrame() {
        this.readyState = 4;
        const callbacks = [...this.callbacks.values()];
        this.callbacks.clear();
        callbacks.forEach((callback) => callback());
      },
    });
    if (frameCallbacks) {
      video.requestVideoFrameCallback = (callback) => {
        const id = ++nextId;
        video.callbacks.set(id, callback);
        return id;
      };
      video.cancelVideoFrameCallback = (id) => video.callbacks.delete(id);
    }
    return video;
  });
  const control = new Events();
  control.attributes = {};
  control.setAttribute = (name, value) => (control.attributes[name] = value);
  const parts = { ".control-icon": {}, ".control-label": {} };
  control.querySelector = (selector) => parts[selector];
  const document = new Events();
  document.hidden = false;
  document.querySelector = () => control;
  document.querySelectorAll = (selector) =>
    selector === ".background-video" ? videos : [];
  const preference = new Events();
  preference.matches = reduced;
  const window = {
    matchMedia: () => preference,
    requestAnimationFrame: (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
  };
  const context = vm.createContext({ window, document });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8"),
    context,
  );
  return {
    videos,
    control,
    document,
    preference,
    frames,
    active: () => vm.runInContext("activeIndex", context),
    switching: () => vm.runInContext("switching", context),
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    finishFade() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("the initial poster stays visible until a frame reaches the compositor", async () => {
  const ui = setup();
  await settle();
  assert.equal(ui.videos[0].paused, false);
  assert.equal(ui.videos[0].classes.has("is-ready"), false);
  ui.videos[0].presentFrame();
  await settle();
  assert.equal(ui.videos[0].classes.has("is-ready"), true);
});

test("blocked autoplay leaves the poster visible", async () => {
  const ui = setup({ blocked: true });
  await settle();
  assert.equal(ui.videos[0].classes.has("is-ready"), false);
  assert.equal(ui.control.attributes["aria-pressed"], "true");
});

test("older browsers wait for decoded data and the next render frame", async () => {
  const ui = setup({ frameCallbacks: false });
  await settle();
  ui.videos[0].readyState = 1;
  ui.videos[0].emit("loadeddata");
  assert.equal(ui.frames.size, 0);
  ui.videos[0].readyState = 2;
  ui.videos[0].emit("loadeddata");
  assert.equal(ui.videos[0].classes.has("is-ready"), false);
  ui.flushFrames();
  await settle();
  assert.equal(ui.videos[0].classes.has("is-ready"), true);
});

test("cached frames do not require another loadeddata event in older browsers", async () => {
  const ui = setup({ frameCallbacks: false, readyState: 4 });
  await settle();
  ui.flushFrames();
  await settle();
  assert.equal(ui.videos[0].classes.has("is-ready"), true);
});

test("the outgoing clip stays visible until the next clip has a frame", async () => {
  const ui = setup();
  await settle();
  ui.videos[0].presentFrame();
  await settle();
  ui.videos[0].currentTime = 9.5;
  ui.videos[0].emit("timeupdate");
  await settle();
  assert.equal(ui.active(), 0);
  assert.equal(ui.videos[0].classes.has("is-active"), true);
  assert.equal(ui.videos[1].classes.has("is-ready"), false);
  ui.videos[1].presentFrame();
  await settle();
  assert.equal(ui.active(), 1);
  assert.equal(ui.videos[1].classes.has("is-ready"), true);
  assert.equal(ui.videos[0].paused, false);
  ui.finishFade();
  assert.equal(ui.videos[0].paused, true);
});

test("pause during initial buffering cancels the pending reveal and supports resume", async () => {
  const ui = setup();
  await settle();
  ui.control.emit("click");
  await settle();
  assert.equal(ui.videos[0].callbacks.size, 0);
  assert.equal(ui.videos[0].classes.has("is-ready"), false);
  ui.control.emit("click");
  await settle();
  ui.videos[0].presentFrame();
  await settle();
  assert.equal(ui.videos[0].classes.has("is-ready"), true);
});

test("pause while the next clip buffers preserves the current frame and position", async () => {
  const ui = setup();
  await settle();
  ui.videos[0].presentFrame();
  await settle();
  ui.videos[0].currentTime = 9.5;
  ui.videos[0].emit("timeupdate");
  await settle();
  ui.control.emit("click");
  await settle();
  assert.equal(ui.active(), 0);
  assert.equal(ui.videos[0].currentTime, 9.5);
  assert.equal(ui.videos[1].callbacks.size, 0);
  assert.equal(ui.switching(), false);
});

test("hiding the tab cancels frame waiting", async () => {
  const ui = setup();
  await settle();
  ui.document.hidden = true;
  ui.document.emit("visibilitychange");
  await settle();
  assert.equal(ui.videos[0].callbacks.size, 0);
  assert.equal(ui.videos[0].classes.has("is-ready"), false);
});

test("reduced motion keeps videos paused and the poster visible", async () => {
  const ui = setup({ reduced: true });
  await settle();
  assert.equal(ui.videos[0].paused, true);
  assert.equal(ui.videos[0].classes.has("is-ready"), false);
  assert.equal(ui.control.hidden, true);
});
