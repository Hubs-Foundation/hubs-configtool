const PromiseThrottle = require('promise-throttle');
const AWS = require("aws-sdk");
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
    this.wrappers = promisifyService(throttle, ssm, ['getParameter', 'getParametersByPath', 'putParameter']);
  }

  async _putValue(path, val) {
    // console.log(`Writing ${path}: ${val}.`);
    return this.wrappers.putParameter({ Name: path, Value: val, Overwrite: true, Type: "String" });
  }

  async _putList(path, vals) {
    // todo: deal with commas in values
    // console.log(`Writing ${path}: ${vals}.`);
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

  async write(service, config) {
    return this._putSubtree(`/${service}`, config);
  }

  async read(service) {
    let pairs = [];
    let nextToken = null;
    do {
      const res = await this.wrappers.getParametersByPath({ Path: `/${service}`, Recursive: true, NextToken: nextToken, WithDecryption: true });
      for (const p of res.Parameters) {
        const val = p.Type === "StringList" ? p.Value.split(",") : p.Value;
        pairs.push([nameToPath(p.Name), val]);
      }
      nextToken = res.NextToken;
    } while(nextToken != null);
    return treeify(pairs)[service];
  }
}

module.exports = { ParameterStore };
