# Decisions

- D-001 (24 Nov): The audit never pushes, deploys or writes to the live database without the owner's explicit word;
  such tasks go to APPROVAL_REQUIRED.md and work continues.
- D-002 (24 Nov): Staff audit log stays insert-only for application roles with a hash chain (0049); no owner-level
  block trigger, because the chain's tamper-detection tests must be able to edit it as owner and an owner can disable
  triggers anyway. The chain is the protection.
- D-003 (24 Nov): Crawler DNS rebinding accepted as low risk: the crawler runs only on the operator's machine against
  public link-in-bio pages; pinning the resolved address needs an HTTP client rewrite out of proportion to the risk.
