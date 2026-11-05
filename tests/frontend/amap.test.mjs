import test from "node:test";
import assert from "node:assert/strict";
import { locateDevice } from "../../cinema/static/js/amap.js";
import { toMapPosition, addressFor } from "../../cinema/static/js/amap-sdk.js";

test("location requires secure browser and maps browser permission errors", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "window", { configurable:true, value:{ isSecureContext:false } });
    await assert.rejects(locateDevice(), /insecure/);
    globalThis.window.isSecureContext = true;
    Object.defineProperty(globalThis, "navigator", { configurable:true, value:{} });
    await assert.rejects(locateDevice(), /unsupported/);
    for (const [code, message] of [[1,"denied"],[2,"unavailable"],[3,"timeout"]]) {
      globalThis.navigator.geolocation = { getCurrentPosition(success, fail, options) {
        assert.equal(options.timeout, 10000); assert.equal(options.maximumAge, 0); fail({code});
      } };
      await assert.rejects(locateDevice(), new RegExp(message));
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis,"window",originalWindow); else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis,"navigator",originalNavigator); else delete globalThis.navigator;
  }
});

test("GPS coordinates must pass conversion before being used for distance", async () => {
  const map = { convertFrom(coords, system, done) {
    assert.deepEqual(coords,[116.39,39.90]); assert.equal(system,"gps");
    done("complete",{locations:[{getLng:()=>116.396,getLat:()=>39.901}]});
  } };
  assert.deepEqual(await toMapPosition(map,{longitude:116.39,latitude:39.90}),[116.396,39.901]);
  await assert.rejects(toMapPosition({convertFrom(a,b,done){done("error",{});}},{longitude:116,latitude:39}),/conversion/);
});

test("failed address lookup does not invent a city", async () => {
  class Geocoder { getAddress(point, done) { done("error",{}); } }
  assert.equal(await addressFor({Geocoder, plugin(name, ready) { assert.equal(name,"AMap.Geocoder"); ready(); }},[116,39]),null);
});
