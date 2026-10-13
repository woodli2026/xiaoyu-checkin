// __tests__/helpers/cloud-db.js —— 忠实的内存版云数据库 + wx-server-sdk 拦截器
//
// 【为什么需要】既有 guard 里的 db 桩，doc().update()/remove() 是 `Promise.resolve({})`
// 的**空操作**（见 aggregate-guard / view-shape-guard）。因此云端「写」的落库结果
// 从来没人验证过——云函数写没写、写对没写对，测试一律全绿。
//
// 本助手提供一个**真的会改内存库**的 db，供云端写路径守卫使用。
//
// 覆盖 cloudfunctions/** 实况用到的 db 能力（已按代码枚举）：
//   db.collection(x).where/orderBy/limit/skip/get/count/add/doc
//   doc(id).get/update/set/remove
//   db.command.in      db.runTransaction(fn) —— fn(t) 的 t 与 db 同形（同一内存库）
//
// doc(id).get() 在文档不存在时**抛错**（与真实 wx-server-sdk 一致，云代码用 .catch 兜）。

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

const IN = Symbol('in');

function createHarness() {
  const collections = {};
  let seq = 0;
  let openid = 'o1';

  const command = { in: (arr) => ({ [IN]: arr }) };
  const isIn = (v) => v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, IN);

  function matches(doc, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => {
      const fv = filter[k];
      if (isIn(fv)) return fv[IN].indexOf(doc[k]) >= 0;
      return doc[k] === fv;
    });
  }

  // 查询构建器：作用于**活引用**（arr 的文档对象），故 update/remove 会反映到内存库
  function query(arr) {
    let data = arr;
    const api = {
      where(f) { data = data.filter((d) => matches(d, f)); return api; },
      orderBy(field, dir) {
        data = data.slice().sort((a, b) => (dir === 'desc' ? b[field] - a[field] : a[field] - b[field]));
        return api;
      },
      limit(n) { data = data.slice(0, n); return api; },
      skip(n) { data = data.slice(n); return api; },
      field() { return api; },
      async get() { return { data: data.map(clone) }; },
      async count() { return { total: data.length }; },
      async update({ data: patch }) {
        let n = 0;
        for (const d of data) { Object.assign(d, clone(patch)); n++; }
        return { stats: { updated: n } };
      },
      async remove() {
        const victims = new Set(data);
        const kept = arr.filter((d) => !victims.has(d));
        const removed = arr.length - kept.length;
        arr.length = 0;
        arr.push(...kept);
        return { stats: { removed } };
      }
    };
    return api;
  }

  function collection(name) {
    if (!collections[name]) collections[name] = [];
    const arr = collections[name];
    return {
      where(f) { return query(arr).where(f); },
      orderBy(f, d) { return query(arr).orderBy(f, d); },
      limit(n) { return query(arr).limit(n); },
      skip(n) { return query(arr).skip(n); },
      get() { return query(arr).get(); },
      count() { return query(arr).count(); },
      async add({ data }) {
        const doc = Object.assign({ _id: name[0] + '_' + (++seq) }, clone(data));
        arr.push(doc);
        return { _id: doc._id };
      },
      doc(id) {
        return {
          async get() {
            const f = arr.find((d) => d._id === id);
            if (!f) {
              const e = new Error('document.get:fail document not exists');
              e.errCode = -1;
              throw e;
            }
            return { data: clone(f) };
          },
          async update({ data: patch }) {
            const f = arr.find((d) => d._id === id);
            if (f) Object.assign(f, clone(patch));
            return { stats: { updated: f ? 1 : 0 } };
          },
          async set({ data }) {
            const i = arr.findIndex((d) => d._id === id);
            const doc = Object.assign({ _id: id }, clone(data));
            if (i >= 0) arr[i] = doc; else arr.push(doc);
            return { _id: id };
          },
          async remove() {
            const i = arr.findIndex((d) => d._id === id);
            if (i >= 0) arr.splice(i, 1);
            return { stats: { removed: i >= 0 ? 1 : 0 } };
          }
        };
      }
    };
  }

  const db = {
    command,
    collection,
    // 事务：本内存实现不支持回滚，对成功路径而言 t 与 db 同形即可
    async runTransaction(fn) { return fn(db); },
    serverDate() { return new Date(); }
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database() { return db; },
    getWXContext() { return { OPENID: openid }; }
  };

  return {
    cloudMock,
    collections,
    setOpenid(id) { openid = id; },
    reset() { for (const k of Object.keys(collections)) delete collections[k]; seq = 0; },
    seed(name, docs) { collections[name] = (docs || []).map(clone); },
    rows(name) { return (collections[name] || []).map(clone); }
  };
}

// 拦截 require('wx-server-sdk')。**必须在 require 任何云函数之前调用**
// （lib/cloud.js 在加载期就 `cloud.database()` 取 db）。返回卸载函数。
function installWxServerSdk(harness) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'wx-server-sdk') return harness.cloudMock;
    return orig.apply(this, arguments);
  };
  return function uninstall() { Module._load = orig; };
}

module.exports = { createHarness, installWxServerSdk };
