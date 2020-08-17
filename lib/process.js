
exports.process = async ({ log, record, db, resolver, dynamo }) => {
  const {
    amount,
    timestamp,
    organizationId,
    description
  } = JSON.parse(record.body)

  // If no org id, throw
  if (!organizationId) throw Error('undefined organization id passed in')

  log.log({ amount, timestamp, organizationId, description })
  // Subtract 3% for stripe percentage fee and 1% for our fee
  // Subtract 30 cents for stripe base charge
  // Multiply by 1000 to turn to millicents
  const donationAmount = ((amount * 0.96) - 30) * 1000

  // If another lambda has already picked up this transaction, it'll be locked on org id
  // preventing us from double paying packages from an org's donation.
  // This will throw if it's locked
  const lockInfo = await dynamo.lockOrg({ organizationId })
  log.log({ lockInfo })

  // TODO get refresh token from organization admin user
  // TODO get repos from version control for organization
  // TODO fetch package manifest files from repos

  const topLevelPackages = []
  const language = 'javascript'
  const registry = 'npm'

  const noCompList = await db.getNoCompList({ language, registry })
  const packageWeightsMap = await resolver.computePackageWeight({ topLevelPackages, language, registry, noCompList })

  await db.distributeOrgDonation({ donationAmount, packageWeightsMap, organizationId })
  await dynamo.unlockOrg({ organizationId })

  log.log({ organizationId, donationAmount, description })
  return { success: true }
}
