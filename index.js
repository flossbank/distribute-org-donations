const AWS = require('aws-sdk')
const Pino = require('pino')
const RegistryResolver = require('@flossbank/registry-resolver')
const Process = require('./lib/process')
const Config = require('./lib/config')
const Db = require('./lib/mongo')
const Dynamo = require('./lib/dynamo')
const GitHub = require('./lib/github')

const kms = new AWS.KMS({ region: 'us-west-2' })
const docs = new AWS.DynamoDB.DocumentClient({ region: 'us-west-2' })

/*
- Get organization info from SQS event
- Lock on org id for processing so no other lambda duplicates the work
- Look up organization in mongo to get installation ID
- Request temporary access from github using GH App PEM and installation ID
- Search organization's repositories for supported manifests (packages.jsons)
- Download all supported manifests, grouped by registry/language (e.g. NPM+JS)
- Merge grouped manifests into single list of Top Level Pkgs (maintaining duplicates)
- Determine package dependencies to create map of package weights
- Compute per-package donation amount (donation * pkgWeight)
- Write computed donation for each package to their respective donationRevenue log
*/
exports.handler = async (event) => {
  const log = Pino()
  const dynamo = new Dynamo({ log, docs })
  const config = new Config({ log, kms, dynamo })

  const retriever = new GitHub({ log, config })
  await retriever.init()

  const db = new Db({ log, config })
  await db.connect()

  const epsilon = await config.getCompensationEpsilon()
  const resolver = new RegistryResolver({ log, epsilon })

  let results
  try {
    results = await Promise.all(
      event.Records.map(record => Process.process({ record, db, dynamo, resolver, retriever, log }))
    )
    if (!results.every(result => result.success)) {
      throw new Error(JSON.stringify(results))
    }
    return results
  } finally {
    await db.close()
  }
}
