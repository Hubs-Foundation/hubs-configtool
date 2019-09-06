# hubs-configtool

Tool for reading and writing Hubs configuration values. WIP.

This tool coerces all configuration into a tree of values, where each value can either be a string, number, or a list of values. So any richer types in e.g. TOML configuration, like dates, will be stringified upon reading and writing.

## Running it

Install dependencies:

``` sh
$ npm ci
```

You can use it as a library, or run it on the command line:

``` sh
# Reads the configuration for the janus-gateway service from AWS Parameter Store
# and pipes it into the local Habitat supervisor for the janus-gateway.default service group
$ ./bin/configtool ps --region=us-west-1 --creds=~/.aws/credentials read janus-gateway | \
  sudo ./bin/configtool hab write janus-gateway.default
```

To run the Habitat integration, you'll need the `hab` binary available; to run the AWS integration,
you'll need an AWS credentials file to provide.
