const PromiseThrottle = require("promise-throttle");
const AWS = require("aws-sdk");
const { promisifyService } = require("./aws-utils");

class CloudFormation {
  constructor(region, accessKeyId, secretAccessKey) {
    const throttle = new PromiseThrottle({ requestsPerSecond: 10 });
    const cf = new AWS.CloudFormation({ region, accessKeyId, secretAccessKey });
    this.wrappers = promisifyService(throttle, cf, ['describeStacks']);
  }

  async write() {
    throw new Error("CloudFormation outputs are read-only.");
  }

  async read(stack) {
    const res = await this.wrappers.describeStacks({ StackName: stack });
    if (res.Stacks.length === 0) {
      throw new Error(`Stack ${stack} not found.`);
    }
    const data = {};
    for (const output of res.Stacks[0].Outputs) {
      data[output.OutputKey] = output.OutputValue;
    }
    return data;
  }
}

module.exports = { CloudFormation };
