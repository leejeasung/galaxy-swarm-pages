/** A tiny reusable object pool used by projectiles and visual effects. */
export class ObjectPool {
  constructor(factory, reset = () => {}) {
    this.factory = factory;
    this.reset = reset;
    this.available = [];
    this.active = new Set();
  }

  acquire() {
    const item = this.available.pop() ?? this.factory();
    this.active.add(item);
    item.active = true;
    return item;
  }

  release(item) {
    if (!item || !this.active.delete(item)) return;
    this.reset(item);
    item.active = false;
    this.available.push(item);
  }

  releaseAll() {
    for (const item of [...this.active]) this.release(item);
  }

  get activeCount() {
    return this.active.size;
  }
}

