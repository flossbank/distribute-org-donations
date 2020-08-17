const test = require('ava')
const sinon = require('sinon')
const Db = require('../lib/mongo')
const Config = require('../lib/config')
const Process = require('../lib/process')
const index = require('../')

test.before(() => {
  sinon.stub(Config.prototype, 'getCompensationEpsilon')
  sinon.stub(Db.prototype, 'connect')
  sinon.stub(Db.prototype, 'close')
  sinon.stub(Process, 'process').resolves({ success: true })
})

test.afterEach(() => {
  Config.prototype.getCompensationEpsilon.reset()
  Db.prototype.connect.reset()
  Db.prototype.close.reset()
  Process.process.reset()
})

test.after.always(() => {
  sinon.restore()
})

test.serial('processes records and closes db', async (t) => {
  t.pass()
  await index.handler({
    Records: [{ body: 'blah' }]
  })
  t.true(Process.process.calledOnce)
  t.true(Db.prototype.close.calledOnce)
})

test.serial('throws on processing errors', async (t) => {
  t.pass()
  Process.process.rejects()
  await t.throwsAsync(index.handler({
    Records: [{ body: 'blah' }]
  }))
  t.true(Db.prototype.close.calledOnce)
})
