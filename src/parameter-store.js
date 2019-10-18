const fs = require("fs");
const util = require("util");
const PromiseThrottle = require('promise-throttle');
const AWS = require("aws-sdk");
const debug = require("debug")("configtool:ps");

// Takes a series of [path, value] pairs, e.g. [["foo", "baz"], 1], [["foo", "bar"], 2]],
// and converts them into a Javascript object, e.g. { "foo": { "bar": 2 }, { "baz": 1 } }.
function treeify(pairs) {
  const data = {};
  for (const [path, v] of pairs) {
    let obj = data;
    for (let i = 0; i < path.length - 1; i++) { // the path except for the end
      const part = path[i];
      obj = part in obj ? obj[part] : (obj[part] = {});
    }
    const name = path[path.length - 1];
    obj[name] = v;
  }
  return data;
}

// Takes a slash-separated parameter name, e.g. "/foo/bar/baz", and converts it into
// an array of path components, e.g. ["foo", "bar", "baz"].
function nameToPath(parameterName) {
  if (parameterName.startsWith("/")) {
    parameterName = parameterName.slice(1);
  }
  return parameterName.split("/");
}

// Replaces the given callback-style methods on the `service` object
// with ones that return a promise. Useful for wrapping AWS SDK interfaces to be more usable.
function promisifyService(service, methodNames) {
  const wrappers = {};
  for (const mn of methodNames) {
    wrappers[mn] = util.promisify(service[mn]).bind(service);
  }
  return wrappers;
}

class ParameterStore {
  constructor(ssmOptions, requestsPerSecond = 3) {
    // experimentally, the free tier requests per second PS can handle seems south of 4
    const ssm = new AWS.SSM(ssmOptions);
    this.throttle = new PromiseThrottle({ requestsPerSecond });
    this.wrappers = promisifyService(ssm, ['deleteParameters', 'getParametersByPath', 'putParameter']);
  }

  async _putValue(path, val) {
    return this.throttle.add(() => {
      debug(`Writing parameter ${path} = ${val}...`);
      return this.wrappers.putParameter({ Name: path, Value: JSON.stringify(val), Overwrite: true, Type: "SecureString" });
    });
  }

  async _putSubtree(path, config) {
    const results = [];
    for (const k in config) {
      const v = config[k];
      const subpath = `${path}/${k}`;
      if (Array.isArray(v)) {
        results.push(this._putSubtree(subpath, v));
      } else if (typeof v === 'object') {
        results.push(this._putSubtree(subpath, v));
      } else {
        results.push(this._putValue(subpath, v));
      }
    }
    return Promise.all(results);
  }

  async _getAllParameters(opts) {
    let result = [];
    let i = 0;
    do {
      const res = await this.throttle.add(() => {
        debug(`Requesting parameters for ${opts.Path} (${++i})...`);
        return this.wrappers.getParametersByPath(opts);
      });
      Array.prototype.push.apply(result, res.Parameters);
      opts.NextToken = res.NextToken;
    } while(opts.NextToken != null);
    return result;
  }

  async write(prefix, config) {
    return this._putSubtree(`/${prefix}`, config);
  }

  async delete(prefix) {
    const params = await this._getAllParameters({ Path: `/${prefix}`, Recursive: true });
    const names = params.map(p => p.Name);
    const results = [];
    for (let i = 0; i < names.length; i += 10) { // API only lets you delete ten at once
      results.push(this.throttle.add(() => {
        const toDelete = names.slice(i, i + 10);
        debug(`Deleting parameters underneath ${prefix} (${i + 1}-${i + toDelete.length}/${names.length})...`);
        return this.wrappers.deleteParameters({ Names: toDelete });
      }));
    }
    return Promise.all(results);
  }

  async read(prefix) {
    let pairs = [];
    const params = await this._getAllParameters({ Path: `/${prefix}`, Recursive: true, WithDecryption: true });
    for (const p of params) {
      try {
        const val = JSON.parse(p.Value);
        const deprefixed = p.Name.slice(prefix.length + 1);
        pairs.push([nameToPath(deprefixed), val]);
      } catch (err) {
        debug(`Failed to read non-JSON config value: ${p.Name} = ${p.Value}`);
      }
    }
    return treeify(pairs);
  }
}

module.exports = { ParameterStore };
