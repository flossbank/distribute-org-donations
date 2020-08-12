// const AWS = require('aws-sdk')
// const Process = require('./lib/process')
// const Config = require('./lib/config')
// const Db = require('./lib/mongo')
// const Dynamo = require('./lib/dynamo')

// const kms = new AWS.KMS({ region: 'us-west-2' })
// const docs = new AWS.DynamoDB.DocumentClient({ region: 'us-west-2' })

/*
- Get organization info from SQS event
- Lock on org id for processing so no other lambda duplicates the work
- Look up organization in mongo
- If !globalDonation: look up one of the admin's refresh tokens for github
    1. request temporary access from github using refresh token
    2. search organization's repositories for supported manifests (packages.jsons)
    3. download all supported manifests, grouped by registry/language (e.g. NPM+JS)
    4. merge grouped manifests into single list of Top Level Pkgs (maintaining duplicates)
    5. determine package dependencies to create map of package weights
3. if globalDonation:
    1. run mongo aggregation to create a map of packages to their global weight
- Compute per-package donation amount (donation * pkgWeight)
- Write computed donation for each package to their respective donationRevenue log
*/
exports.handler = async (event) => {
  // const log = console
  // const dynamo = new Dynamo({ docs })
  // const config = new Config({ kms })
  // const db = new Db({ config })
  // await db.connect()

  // let results
  try {
    // results = await Promise.all(
    //   event.Records.map(record => Process.process({ record, db, dynamo, log }))
    // )
    // if (!results.every(result => result.success)) {
    //   throw new Error(JSON.stringify(results))
    // }
    // return results
  } finally {
    // await db.close()
  }
}
