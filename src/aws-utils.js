const fs = require("fs");
const util = require("util");

// Replaces the given callback-style methods on the `service` object
// with ones that return a throttled promise. Useful for wrapping
// AWS SDK interfaces to be more usable.
function promisifyService(throttle, service, methodNames) {
  const wrappers = {};
  for (const mn of methodNames) {
    const m = util.promisify(service[mn]);
    wrappers[mn] = (...args) => {
      return throttle.add(() => m.apply(service, args));
    };
  }
  return wrappers;
}

module.exports = { promisifyService };
