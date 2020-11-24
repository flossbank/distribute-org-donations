exports.process = async ({ log, record, db, retriever, resolver, dynamo }) => {
  const {
    amount,
    timestamp,
    organizationId,
    description
  } = JSON.parse(record.body)

  // If no org id, throw
  if (!organizationId) throw Error('undefined organization id passed in')

  log.info({ amount, timestamp, organizationId, description })
  // Subtract 3% for stripe percentage fee and 1% for our fee
  // Subtract 30 cents for stripe base charge
  // Multiply by 1000 to turn to millicents
  const donationAmount = ((amount * 0.96) - 30) * 1000

  // If another lambda has already picked up this transaction, it'll be locked on org id
  // preventing us from double paying packages from an org's donation.
  // This will throw if it's locked
  const lockInfo = await dynamo.lockOrg({ organizationId })
  log.info({ lockInfo })

  const { name, installationId } = await db.getOrg({ organizationId })

  // get manifest search patterns for each supported registry+language
  // e.g. "package.json" is the only manifest search pattern for JavaScript/NPM
  // this call returns a list of [{ registry, language, patterns }, ...]
  const searchPatterns = resolver.getSupportedManifestPatterns()
  log.info('Using %d search pattern(s) to find package manifest files within org', searchPatterns.length)

  // call the code host (e.g. GitHub) to search all the org's repos for each of the search patterns
  // this call returns a list of [{ registry, language, manifest }, ...] -- that is, a separate
  // object for each manifest file found, alongside its registry and language. the manifest is unparsed (raw utf8)
  const packageManifests = await retriever.getAllManifestsForOrg({ name, installationId }, searchPatterns)
  log.info('Downloaded %d package manifests', packageManifests.length)

  // now ask the registry resolver to parse the manifest files according to whichever registry/language they are
  // so, for example, { registry: npm, language: javascript, manifest: <some JSON string> } will be parsed as
  // JSON and the dependencies+devDependencies fields will be extracted as top level dependencies.
  // this call returns a list of [{ registry, language, deps }, ...] for each registry and language -- even if
  // there are many unique manifests passed in for the registry and language. it will group all the deps for
  // the registry/language combination into a single list.
  const extractedDependencies = resolver.extractDependenciesFromManifests(packageManifests)
  log.info('Dependencies extracted for %d different registry/language combinations', extractedDependencies.length)

  // now that we have top level packages for each supported registry/language, we map that list into
  // [{ registry, language, weightMap }, ...]; effectively replacing the `deps` with their full dependency tree,
  // weighted.
  const packageWeightMaps = await Promise.all(extractedDependencies.map(async ({ language, registry, deps }) => {
    if (!deps.length) {
      return { language, registry, weightMap: new Map() }
    }
    const noCompList = await db.getNoCompList({ language, registry })
    const weightMap = await resolver.computePackageWeight({ topLevelPackages: deps, language, registry, noCompList })

    return { language, registry, weightMap }
  }))

  // now time to distribute the donation to the packages present in the org's repos.
  // first we determine how many unique packages were found (or computed via dep graph traversal) across all
  // registries and languages. then we dedicate a portion of the donation to each registry/language based on
  // the number of packages found for that registry/language. finally, we update our DB, upserting any newly
  // found packages, and applying their weight to the donation portion.
  const totalPackages = packageWeightMaps.reduce((total, { weightMap }) => total + weightMap.size, 0)
  log.info('Dependencies across all supported downloaded manifests: %d', totalPackages)

  await Promise.all(packageWeightMaps.map(async ({ language, registry, weightMap }) => {
    // using Math.floor to guarantee we don't overspend due to floating point math issues
    const donationToLangReg = Math.floor(donationAmount * (weightMap.size / totalPackages))
    if (!donationToLangReg) return
    return db.distributeOrgDonation({
      donationAmount: donationToLangReg,
      packageWeightsMap: weightMap,
      language,
      registry,
      organizationId
    })
  }))

  await db.createOrganizationOssUsageSnapshot({
    organizationId,
    totalDependencies: totalPackages,
    topLevelDependencies: extractedDependencies.reduce((acc, reg) => acc + reg.deps.length, 0)
  })

  // all done! unlock and gtfo
  await dynamo.unlockOrg({ organizationId })

  log.info({ organizationId, donationAmount, description })
  return { success: true }
}
