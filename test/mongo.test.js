const test = require('ava')
const sinon = require('sinon')
const { MongoClient, ObjectId } = require('mongodb')
const Mongo = require('../lib/mongo')
const ULID = require('ulid')

test.before(() => {
  sinon.stub(Date, 'now').returns(1234)
  sinon.stub(ULID, 'ulid').returns('bbbbbbbbbbbb')
})

test.beforeEach((t) => {
  t.context.mongo = new Mongo({
    config: {
      getMongoUri: async () => 'mongodb+srv://0.0.0.0/test'
    },
    log: {
      info: sinon.stub()
    }
  })

  t.context.organizationId = 'aaaaaaaaaaaa'
  t.context.packageWeightsMap = new Map([['standard', 0.05], ['js-deep-equals', 0.75], ['yttrium-server', 0.2]])

  t.context.mongo.db = {
    collection: sinon.stub().returns({
      updateOne: sinon.stub(),
      initializeUnorderedBulkOp: sinon.stub().returns({
        find: sinon.stub().returns({
          upsert: sinon.stub().returns({
            updateOne: sinon.stub()
          })
        }),
        execute: sinon.stub().returns({ nModified: 2 })
      })
    })
  }
})

test('connect', async (t) => {
  sinon.stub(MongoClient.prototype, 'connect')
  sinon.stub(MongoClient.prototype, 'db')

  await t.context.mongo.connect()
  t.true(MongoClient.prototype.connect.calledOnce)

  MongoClient.prototype.connect.restore()
  MongoClient.prototype.db.restore()
})

test('close', async (t) => {
  await t.context.mongo.close()
  t.context.mongo.mongoClient = { close: sinon.stub() }
  await t.context.mongo.close()
  t.true(t.context.mongo.mongoClient.close.calledOnce)
})

test('get org', async (t) => {
  const { mongo } = t.context

  const organization = {
    name: 'flossbank',
    installationId: 'abc',
    host: 'GitHub'
  }
  mongo.db = {
    collection: (col) => ({
      findOne: sinon.stub().resolves(organization)
    })
  }

  const res = await mongo.getOrg({ organizationId: 'aaaaaaaaaaaa' })
  t.deepEqual(res, { name: 'flossbank', host: 'GitHub', installationId: 'abc' })
})

test('get org | no org', async (t) => {
  const { mongo } = t.context

  mongo.db = {
    collection: (col) => ({
      findOne: sinon.stub().resolves()
    })
  }

  const res = await mongo.getOrg({ organizationId: 'aaaaaaaaaaaa' })
  t.is(res, undefined)
})

test('get no comp list | supported', async (t) => {
  const { mongo } = t.context

  mongo.db = {
    collection: () => ({
      findOne: sinon.stub().resolves({ language: 'javascript', registry: 'npm', list: ['react'] })
    })
  }

  const res = await mongo.getNoCompList({ language: 'javascript', registry: 'npm' })
  t.deepEqual(res, new Set(['react']))
})

test('get no comp list | unsupported', async (t) => {
  const { mongo } = t.context

  mongo.db = {
    collection: () => ({
      findOne: sinon.stub().resolves()
    })
  }

  const res = await mongo.getNoCompList({ language: 'javascript', registry: 'npm' })
  t.deepEqual(res, new Set())
})

test('bail on empty package weights map', async (t) => {
  const donationAmount = 500000 // 5 bucks in mc
  await t.context.mongo.distributeOrgDonation({
    organizationId: t.context.organizationId,
    packageWeightsMap: new Map(),
    registry: 'npm',
    langauge: 'javascript',
    donationAmount
  })
  // Should not call bulk op
  t.false(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().upsert().updateOne.called)
})

test('snapshot', async (t) => {
  const { mongo, organizationId } = t.context

  await mongo.createOrganizationOssUsageSnapshot({
    organizationId,
    totalDependencies: 100,
    topLevelDependencies: 1200
  })

  t.deepEqual(mongo.db.collection().updateOne.lastCall.args, [{
    _id: ObjectId(organizationId)
  }, {
    $push: {
      snapshots: { timestamp: Date.now(), totalDependencies: 100, topLevelDependencies: 1200 }
    }
  }])
})

test('distribute org donation | success', async (t) => {
  const { packageWeightsMap, organizationId, mongo } = t.context
  const donationAmount = 1000000 // 10 bucks in mc
  const language = 'javascript'
  const registry = 'npm'
  await mongo.distributeOrgDonation({
    organizationId,
    packageWeightsMap,
    language,
    registry,
    donationAmount
  })

  // 3 pushes for 3 diff packages in our packageWeightsMap
  t.true(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().upsert().updateOne.calledWith({
    $push: {
      donationRevenue: {
        organizationId,
        timestamp: 1234,
        amount: packageWeightsMap.get('standard') * donationAmount,
        id: 'bbbbbbbbbbbb'
      }
    }
  }))
  t.true(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().upsert().updateOne.calledWith({
    $push: {
      donationRevenue: {
        organizationId: t.context.organizationId,
        timestamp: 1234,
        amount: packageWeightsMap.get('yttrium-server') * donationAmount,
        id: 'bbbbbbbbbbbb'
      }
    }
  }))
  t.true(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().upsert().updateOne.calledWith({
    $push: {
      donationRevenue: {
        organizationId: t.context.organizationId,
        timestamp: 1234,
        amount: packageWeightsMap.get('js-deep-equals') * donationAmount,
        id: 'bbbbbbbbbbbb'
      }
    }
  }))
})
