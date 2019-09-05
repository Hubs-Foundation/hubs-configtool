const PromiseThrottle = require('promise-throttle');
const AWS = require("aws-sdk");
const debug = require("debug")("configtool:ps");
const { promisifyService } = require("./aws-utils");

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

class ParameterStore {
  constructor(region, accessKeyId, secretAccessKey) {
    // experimentally, this doesn't seem to trigger rate limiting
    // when putting a configuration worth of values. 5 per second does.
    const throttle = new PromiseThrottle({ requestsPerSecond: 2 });
    const ssm = new AWS.SSM({ region, accessKeyId, secretAccessKey });
    this.wrappers = promisifyService(throttle, ssm, ['deleteParameters', 'getParametersByPath', 'putParameter']);
  }

  async _putValue(path, val) {
    debug(`Writing parameter ${path} = ${val}...`);
    return this.wrappers.putParameter({ Name: path, Value: val, Overwrite: true, Type: "String" });
  }

  async _putList(path, vals) {
    // todo: deal with commas in values
    debug(`Writing parameter ${path} = ${vals.join(',')}...`);
    return this.wrappers.putParameter({ Name: path, Value: vals.join(','), Overwrite: true, Type: "StringList" });
  }

  async _putSubtree(path, subtree) {
    for (const k in subtree) {
      const v = subtree[k];
      const subpath = `${path}/${k}`;
      if (Array.isArray(v)) {
        await this._putList(subpath, v);
      } else if (typeof v === 'object') {
        await this._putSubtree(subpath, v);
      } else {
        await this._putValue(subpath, v.toString());
      }
    }
  }

  async _getAllParameters(opts) {
    let result = [];
    let i = 0;
    do {
      debug(`Requesting parameters for ${opts.Path} (${++i})...`);
      const res = await this.wrappers.getParametersByPath(opts);
      Array.prototype.push.apply(result, res.Parameters);
      opts.NextToken = res.NextToken;
    } while(opts.NextToken != null);
    return result;
  }

  async delete(service) {
    const params = await this._getAllParameters({ Path: `/${service}`, Recursive: true });
    const names = params.map(p => p.Name);
    for (let i = 0; i < names.length; i += 10) { // API only lets you delete ten at once
      debug(`Deleting parameters for /${service} (${i + 1}/${names.length + 1})...`);
      await this.wrappers.deleteParameters({ Names: names.slice(i, i + 10) });
    }
  }

  async write(service, config) {
    return this._putSubtree(`/${service}`, config);
  }

  async read(service) {
    let pairs = [];
    const params = await this._getAllParameters({ Path: `/${service}`, Recursive: true, WithDecryption: true });
    for (const p of params) {
      const val = p.Type === "StringList" ? p.Value.split(",") : p.Value;
      pairs.push([nameToPath(p.Name), val]);
    }
    return treeify(pairs)[service];
  }
}

module.exports = { ParameterStore };
