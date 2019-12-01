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

function hasServiceGroup(host, port, service, group, org) {
  const orgSuffix = org ? `@${org}` : "";
  const path = `/services/${service}/${group}${orgSuffix}/config`;

  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', host, port, path }, res => {
      if (res.statusCode === 404) {
        const req = http.request({ method: 'GET', host, port, path: "/services" }, res => {
          let body = "";
          res.on("data", chunk => body += chunk);
          res.on("end", () => {
            try {
              resolve(!!JSON.parse(body).find(s => s.service_group === `${service}.${group}${orgSuffix}`));
            } catch (err) {
              reject(err);
            }
          });
        });

        req.on('error', reject);
        req.end();
      } else if (res.statusCode !== 200) {
        reject(new Error(`Error fetching config for ${service}.${group}: ${res.statusMessage}.`));
      } else {
        resolve(true);
      }
    });
    req.on('error', reject);
    req.end();
  });
}

function fetchConfig(host, port, service, group, org) {
  const orgSuffix = org ? `@${org}` : "";
  const path = `/services/${service}/${group}${orgSuffix}/config`;

  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', host, port, path }, res => {
      if (res.statusCode === 404) {
        const path = "/services";
        const req = http.request({ method: 'GET', host, port, path }, res => {
          let body = "";
          res.on("data", chunk => body += chunk);
          res.on("end", () => {
            try {
              const services = JSON.parse(body);

              if (services.find(s => s.service_group === `${service}.${group}${orgSuffix}`)) {
                // Service is in supervisor, but no configs yet (404)
                debug(`No configs for ${service}.${group}${orgSuffix}, initializing.`);
                resolve({});
              } else {
                reject(new Error(`Service group ${service}.${group}${orgSuffix} not found.`));
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        req.on('error', reject);
        req.end();
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
    req.on('error', reject);
    req.end();
  });
}

function fetchVersion(host, port, service, group, org) {
  const orgSuffix = org ? `@${org}` : "";
  const path = `/census`;

  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', host, port, path }, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Error fetching config for ${service}.${group}: ${res.statusMessage}.`));
      } else {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            const orgSuffix = org ? `@${org}` : "";
            const serviceGroup = JSON.parse(body)["census_groups"][`${service}.${group}${orgSuffix}`];
            const incarnation = serviceGroup && serviceGroup["service_config"] && serviceGroup["service_config"]["incarnation"];

            if (incarnation) {
              resolve(parseInt(incarnation));
            } else {
              resolve(null);
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    });
    req.on('error', reject);
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
  constructor(habCommand = "hab", httpHost = "localhost", httpPort = 9631, supHost = "localhost", supPort = 9632) {
    this.habCommand = habCommand;
    this.httpHost = httpHost;
    this.httpPort = httpPort;
    this.supHost = supHost;
    this.supPort = supPort;
  }

  async write(service, group, org, config, version) {
    const remote =`${this.supHost}:${this.supPort}`;
    const orgSuffix = org ? `@${org}` : "";
    const args = ["config", "apply", "-r", remote, `${service}.${group}${orgSuffix}`, version];
    const input = toml.stringify(config);
    debug(`Invoking hab: ${this.habCommand} ${args.join(" ")}`);
    return promisifyCommand(this.habCommand, args, input);
  }

  async read(service, group, org) {
    debug(`Requesting Habitat config for ${service}.${group}.`);
    const res = await fetchConfig(this.httpHost, this.httpPort, service, group, org);
    return sanitizeTree(res);
  }

  async getVersion(service, group, org) {
    debug(`Requesting Habitat config version for ${service}.${group}.`);
    return await fetchVersion(this.httpHost, this.httpPort, service, group, org);
  }

  async has(service, group, org) {
    return await hasServiceGroup(this.httpPost, this.httpPort, service, group, org);
  }
}

module.exports = { Habitat };
