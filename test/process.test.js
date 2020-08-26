const test = require('ava')
const sinon = require('sinon')
const Process = require('../lib/process')

test.beforeEach((t) => {
  const db = {
    getNoCompList: sinon.stub().resolves(new Set()),
    getOrgAccessToken: sinon.stub().resolves({ name: 'flossbank', accessToken: 'asdf' }),
    distributeOrgDonation: sinon.stub()
  }
  const dynamo = {
    lockOrg: sinon.stub().resolves({ success: true }),
    unlockOrg: sinon.stub().resolves({ success: true })
  }
  const resolver = {
    getSupportedManifestPatterns: sinon.stub().resolves(['package.json']),
    extractDependenciesFromManifests: sinon.stub().returns([{
      language: 'javascript',
      registry: 'npm',
      deps: ['standard', 'js-deep-equals', 'yttrium-server']
    }, {
      language: 'php',
      registry: 'idk',
      deps: ['some-php-dep']
    }, {
      language: 'haskell',
      registry: 'idk',
      deps: []
    }]),
    computePackageWeight: sinon.stub()
      .onFirstCall().resolves(new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]]))
      .onSecondCall().resolves(new Map([['some-php-dep', 1]]))
      .onThirdCall().resolves(new Map())
  }
  const retriever = {
    getAllManifestsForOrg: sinon.stub().returns([{
      language: 'javascript',
      registry: 'npm',
      manifest: JSON.stringify({ dependencies: { standard: '12.0.1' } })
    }, {
      language: 'php',
      registry: 'idk',
      manifest: 'asdf'
    }])
  }
  const log = { info: sinon.stub() }

  t.context.services = {
    db,
    dynamo,
    resolver,
    retriever,
    log
  }

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
  const { services, testRecord, recordBody } = t.context
  const res = await Process.process({
    record: testRecord,
    ...services
  })
  const expectedDonationAmount = ((recordBody.amount * 0.96) - 30) * 1000

  t.deepEqual(res, { success: true })
  t.true(services.dynamo.lockOrg.calledWith({ organizationId: 'test-org-id' }))
  t.true(services.resolver.getSupportedManifestPatterns.calledOnce)
  t.true(services.retriever.getAllManifestsForOrg.calledOnce)
  t.true(services.resolver.extractDependenciesFromManifests.calledOnce)

  t.true(services.db.getNoCompList.calledWith({ language: 'javascript', registry: 'npm' }))
  t.true(services.db.getNoCompList.calledWith({ language: 'php', registry: 'idk' }))
  t.true(services.resolver.computePackageWeight.calledWith({
    language: 'javascript',
    noCompList: new Set(),
    registry: 'npm',
    topLevelPackages: ['standard', 'js-deep-equals', 'yttrium-server']
  }))
  t.true(services.resolver.computePackageWeight.calledWith({
    language: 'php',
    registry: 'idk',
    noCompList: new Set(),
    topLevelPackages: ['some-php-dep']
  }))

  t.deepEqual(services.db.distributeOrgDonation.firstCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (3 / 4)), // donation for 3 JavaScript deps out of 4 total deps found
    packageWeightsMap: new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]]),
    language: 'javascript',
    registry: 'npm',
    organizationId: 'test-org-id'
  })
  t.deepEqual(services.db.distributeOrgDonation.secondCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (1 / 4)), // donation for 1 PHP dep out of 4 total deps found
    packageWeightsMap: new Map([['some-php-dep', 1]]),
    language: 'php',
    registry: 'idk',
    organizationId: 'test-org-id'
  })
  t.true(services.dynamo.unlockOrg.calledWith({ organizationId: 'test-org-id' }))
})

test('process | failure, undefined org id', async (t) => {
  const { services } = t.context
  await t.throwsAsync(Process.process({
    ...services,
    record: t.context.undefinedOrgTestBody
  }))
})

test('process | failure, org already locked', async (t) => {
  const { services } = t.context
  const { dynamo } = services
  dynamo.lockOrg.rejects()
  await t.throwsAsync(Process.process({
    record: t.context.testRecord,
    ...services
  }))
  t.false(services.db.distributeOrgDonation.calledOnce)
})

test('process | failure, distributeOrgDonation fails', async (t) => {
  const { services } = t.context
  const { db } = services
  db.distributeOrgDonation.rejects()
  await t.throwsAsync(Process.process({
    record: t.context.testRecord,
    ...services
  }))
})
