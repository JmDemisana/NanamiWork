# Local model picker

Feature: `localModelPicker`. Deployments: cloud and self-hosted. Owner: JmDemisana.

When enabled, the model picker opens as a full page with sortable connected accounts and a configurable local router. Router selection chooses a concrete account and model at selection time; it does not reroute each message. Known exhausted quotas are skipped, while unknown quotas remain eligible. Account and model order, inclusion, priorities and router usage are saved locally.

For signed-out desktop users, the local rollout is on by default and does not query Den. Settings → Preferences → Full-page model picker can turn it off, restoring the previous picker without deleting router settings. Signed-in managed and browser sessions still require the registry-backed deployment feature; its default is off, and it remains off when the feature service cannot be reached. The local preference can also disable it in these sessions, but cannot bypass their policy.

Validate account switching, quota states, ordering, keyboard navigation, and provider login before rollout.

UI screenshot verification is still required before rollout.
