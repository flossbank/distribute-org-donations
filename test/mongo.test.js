const test = require('ava')
const sinon = require('sinon')
const { MongoClient } = require('mongodb')
const Mongo = require('../lib/mongo')

test.before(() => {
  sinon.stub(Date, 'now').returns(1234)
})

test.beforeEach((t) => {
  t.context.mongo = new Mongo({
    config: {
      getMongoUri: async () => 'mongodb+srv://0.0.0.0/test'
    }
  })

  t.context.organizationId = 'aaaaaaaaaaaa'
  t.context.packageWeightsMap = new Map([['package-1aaa', 0.015], ['package-2bbb', 0.5], ['package-3ccc', 1.5]])

  t.context.mongo.db = {
    collection: sinon.stub().returns({
      initializeUnorderedBulkOp: sinon.stub().returns({
        find: sinon.stub().returns({
          updateOne: sinon.stub()
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

test('bail on empty package weights map', async (t) => {
  const donationAmount = 500000 // 5 bucks in mc
  await t.context.mongo.distributeOrgDonation({
    organizationId: t.context.organizationId,
    packageWeightsMap: new Map(),
    donationAmount
  })
  // Should not call bulk op
  t.false(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().updateOne.calledOnce)
})

test('distribute org donation | success', async (t) => {
  const donationAmount = 1000000 // 10 bucks in mc
  const packageWeightsMap = t.context.packageWeightsMap
  const expectedTotalMass = [...t.context.packageWeightsMap.values()].reduce((acc, val) => acc + val, 0)
  await t.context.mongo.distributeOrgDonation({ organizationId: t.context.organizationId, packageWeightsMap, donationAmount })
  // 3 pushes for 3 diff packages in our packageWeightsMap
  t.true(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().updateOne.calledWith({
    $push: {
      donationRevenue: {
        organizationId: t.context.organizationId,
        timestamp: 1234,
        amount: ((packageWeightsMap.get('package-1aaa') / expectedTotalMass) * donationAmount)
      }
    }
  }))
  t.true(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().updateOne.calledWith({
    $push: {
      donationRevenue: {
        organizationId: t.context.organizationId,
        timestamp: 1234,
        amount: ((packageWeightsMap.get('package-2bbb') / expectedTotalMass) * donationAmount)
      }
    }
  }))
  t.true(t.context.mongo.db.collection().initializeUnorderedBulkOp().find().updateOne.calledWith({
    $push: {
      donationRevenue: {
        organizationId: t.context.organizationId,
        timestamp: 1234,
        amount: ((packageWeightsMap.get('package-3ccc') / expectedTotalMass) * donationAmount)
      }
    }
  }))
})
