# distribute-org-donations

Lambda to distribute enterprise donations to their dependencies. Is fired on Stripe webhook when we receive a payment from a company and finds and distributes the payment to the orgs dependencies at that given time.

Lambda timeout is set to 15 minutes set via the template.yml, and the visibility timeout is set to be 16 minutes
to ensure two lambdas can't run on the same donation.

## Supported registries

* NPM