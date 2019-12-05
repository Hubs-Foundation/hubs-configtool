const level = require("level");

async function keyExists(db, key) {
  return new Promise((res, rej) => {
    this.db.get(name, err => {
      if (err) {
        if (err.notFound) {
          res(false);
        } else {
          rej(err);
        }
      } else {
        res(true);
      }
    });
  });
};

// LevelDB backed implementation compatible with AWS.SSM for parameter storage
//
// Note that not all features are implemented, just enough to support the ParameterStore interface.
class LevelParameters {
  async constructor({ location }) {
    this.db = await new Promise(res => level(location, {}, res));
  }

  async deleteParameters({ Names }) {
    const InvalidParameters = [];
    const DeletedParameters = [];

    for (let name of Names) {
      const exists = await keyExists(this.db, name);

      if (exists) {
        await this.db.del(name);
        DeletedParameters.push(name);
      } else {
        InvalidParameters.push(name);
      }
    }

    return { DeletedParameters, InvalidParameters };
  }

  // NOTE only Name, Value, and Type are supported in return value.
  getParametersByPath({ Path, Recursive, ParameterFilters, WithDecryption }) {
    if (!Recursive) throw new Error("Non-recursive scan not supported.");
    if (ParameterFilters) throw new Error("Parameter filters not supported.");

    const Parameters = [];

    return new Promise((res, rej) => {
      this.db.createReadStream({ gte: Path })
        .on('data', { Name, Value } => {
          Parameters.push({ Name, Value, Type: "String" })
        })
        .on('error', rej)
        .on('end', res({ Parameters, NextToken: null }));
    });
  }

  async putParameter({ Name, Value, Overwrite, Type, Description, AllowedPattern }) {
    if (Type !== "String") throw new Error(`Unsupported type: ${Type}`)
    if (!Overwrite) throw new Error("Non-overwriting put not supported.");
    if (Description) throw new Error("Descriptions not supported.");
    if (AllowedPattern) throw new Error("AllowedPattern not supported.");

    await this.db.put(Name, Value);

    return {
      Version: (new Date()).getTime(), Tier: "Standard"
    }
  }
}

module.exports = { LevelParameters }
