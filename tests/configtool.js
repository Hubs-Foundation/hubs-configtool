const test = require('tape');
const { CloudFormation, Habitat, ParameterStore } = require('../src/index.js');

async function run() {
  test('Basic functionality', function(t) {
    t.end();
  });
}

run().catch(err => {
  console.log(err);
});
