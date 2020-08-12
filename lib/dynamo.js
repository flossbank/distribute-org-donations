class Dynamo {
  constructor ({ docs }) {
    this.docs = docs
    this.LOCKS_TABLE = 'flossbank_locks'
    this.LOCK_TIMEOUT = 180 * 1000 // 3mins in ms, same as max execution time of lambda
  }

  async lockOrg ({ organizationId }) {
    // get lock info from flossbank_lambda_locks table
    // and lock on the user id for processing
    const { Attributes: lockInfo } = await this.docs.update({
      TableName: this.LOCKS_TABLE,
      Key: { lock_key: organizationId },
      UpdateExpression: 'SET locked_until = :lockTimeout',
      ConditionExpression: 'attribute_not_exists(locked_until) OR locked_until < :now',
      ExpressionAttributeValues: {
        ':lockTimeout': Date.now() + this.LOCK_TIMEOUT,
        ':now': Date.now()
      },
      ReturnValues: 'ALL_NEW'
    }).promise()
    return lockInfo
  }

  async unlockOrg ({ organizationId }) {
    return this.docs.delete({
      TableName: this.LOCKS_TABLE,
      Key: { lock_key: organizationId }
    }).promise()
  }
}

module.exports = Dynamo
