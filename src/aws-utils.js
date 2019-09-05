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

// Reads credentials from an AWS credential config file at path.
// (See https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/setup-credentials.html).
function readCredentials(path) {
  const creds = fs.readFileSync(path);
  const accessKeyId = /aws_access_key_id = (.+)\n/.exec(creds)[1];
  const secretAccessKey = /aws_secret_access_key = (.+)\n/.exec(creds)[1];
  return { accessKeyId, secretAccessKey };
}

module.exports = { promisifyService, readCredentials };
