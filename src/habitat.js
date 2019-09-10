const http = require('http');
const toml = require('@iarna/toml');
const debug = require("debug")("configtool:hab");
const childProcess = require('child_process');

// Runs the given command and arguments as a subprocess, passes the provided
// string into stdin, and returns a promise that either resolves to stdout or
// rejects if the child process terminates with code != 0.
function promisifyCommand(cmd, args, stdin) {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on('data', s => { stdout += s; });
    proc.stderr.on('data', s => { stderr += s; });
    proc.stdin.write(stdin);
    proc.stdin.end();
    proc.on('error', err => reject(err));
    proc.on('close', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${cmd} exited with code ${code}:\n${stderr}`));
      }
    });
  });
}

// GETs a URL given the provided HTTP options and resolves to the JSON body contents.
function fetchConfig(host, port, service, group) {
  const path = `/services/${service}/${group}/config`;
  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', host, port, path }, res => {
      if (res.statusCode === 404) {
        reject(new Error(`Service group ${service}.${group} not found.`));
      } else if (res.statusCode !== 200) {
        reject(new Error(`Error fetching config for ${service}.${group}: ${res.statusMessage}.`));
      } else {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    });
    req.on('error', err => {
      reject(err);
    });
    req.end();
  });
}

function isEmptyObject(obj) {
  return typeof obj === "object" && Object.keys(obj).length === 0;
}

// Coerce Habitat config output into our typical cross-store config output.
// Returns a new identical object with empty objects having been toasted.
function sanitizeTree(obj) {
  if (Array.isArray(obj)) {
    return obj.map(v => sanitizeTree(v));
  } else if (typeof obj === 'object') {
    let res = {};
    for (const k in obj) {
      const v = obj[k];
      if (!isEmptyObject(v)) {
        res[k] = sanitizeTree(v);
      }
    }
    return res;
  } else {
    return obj;
  }
}

class Habitat {
  constructor(httpHost = "localhost", httpPort = 9631, supHost = "localhost", supPort = 9632) {
    this.httpHost = httpHost;
    this.httpPort = httpPort;
    this.supHost = supHost;
    this.supPort = supPort;
  }

  async write(service, group, config, version) {
    const remote =`${this.supHost}:${this.supPort}`;
    const args = ["config", "apply", "-r", remote, `${service}.${group}`, version];
    const input = toml.stringify(config);
    debug(`Invoking hab: hab ${args.join(" ")}`);
    return promisifyCommand('hab', args, input);
  }

  async read(service, group) {
    debug(`Requesting Habitat config for ${service}.${group}.`);
    const res = await fetchConfig(this.httpHost, this.httpPort, service, group);
    return sanitizeTree(res);
  }
}

module.exports = { Habitat };
