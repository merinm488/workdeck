# Workdeck delivery preference

- After completing and testing requested Workdeck changes, deploy them to the existing production app without waiting for a separate deployment request. This is the user's standing preference for this project.
- Production: `https://mer-workdeck.fazt.sh`, Holm peer `zyt-space`, app `holm_app_ZZNXL3c5t1ER`. Update this app; do not create a replacement or move its host.
- Build the Holm package outside the repository with `node scripts/build-holm-landing.mjs /tmp/workdeck-holm-release`. Run relevant tests and `holm app validate --spec-v1 /tmp/workdeck-holm-release` before deployment.
- Deploy with `holm @zyt-space app deploy /tmp/workdeck-holm-release --host mer-workdeck.fazt.sh --spec-v1 --force`. Verify the live assets/pages afterward and report the result. If checks or deployment fail, report the blocker rather than claiming the site is updated.
- Preserve unrelated uncommitted changes and never bundle local credentials, test account data, or secrets.
