const test = require('ava')
const sinon = require('sinon')
const Process = require('../lib/process')

test.beforeEach((t) => {
  t.context.db = {
    getNoCompList: sinon.stub(),
    distributeOrgDonation: sinon.stub()
  }
  t.context.dynamo = {
    lockOrg: sinon.stub().resolves({ success: true }),
    unlockOrg: sinon.stub().resolves({ success: true })
  }
  t.context.resolver = {
    computePackageWeight: sinon.stub().resolves(new Map())
  }
  t.context.log = { log: sinon.stub() }
  t.context.recordBody = {
    amount: 1000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: 'testing donation'
  }
  t.context.testRecord = {
    body: JSON.stringify(t.context.recordBody)
  }
  t.context.undefinedOrgRecordBody = {
    amount: 1000,
    timestamp: 1234,
    organizationId: undefined,
    description: 'testing donation'
  }
  t.context.undefinedOrgTestBody = {
    body: JSON.stringify(t.context.undefinedOrgRecordBody)
  }
})

test('process | success', async (t) => {
  const res = await Process.process({
    db: t.context.db,
    log: t.context.log,
    dynamo: t.context.dynamo,
    record: t.context.testRecord,
    resolver: t.context.resolver
  })
  const expectedDonationAmount = ((t.context.recordBody.amount * 0.96) - 30) * 1000

  t.deepEqual(res, { success: true })
  t.true(t.context.dynamo.lockOrg.calledWith({ organizationId: 'test-org-id' }))
  t.true(t.context.db.distributeOrgDonation.calledWith({
    donationAmount: expectedDonationAmount,
    packageWeightsMap: new Map(),
    organizationId: 'test-org-id'
  }))
  t.true(t.context.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | failure, undefined org id', async (t) => {
  await t.throwsAsync(Process.process({
    db: t.context.db,
    log: t.context.log,
    dynamo: t.context.dynamo,
    record: t.context.undefinedOrgTestRecord,
    resolver: t.context.resolver
  }))
})

test('process | failure, org already locked', async (t) => {
  t.context.dynamo.lockOrg.rejects()
  await t.throwsAsync(Process.process({
    db: t.context.db,
    log: t.context.log,
    dynamo: t.context.dynamo,
    record: t.context.testRecord,
    resolver: t.context.resolver
  }))
  t.false(t.context.db.distributeOrgDonation.calledOnce)
})

test('process | failure, distributeOrgDonation fails', async (t) => {
  t.context.db.distributeOrgDonation.rejects()
  await t.throwsAsync(Process.process({
    db: t.context.db,
    log: t.context.log,
    dynamo: t.context.dynamo,
    record: t.context.testRecord,
    resolver: t.context.resolver
  }))
})
