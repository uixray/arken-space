# Yandex Object Storage for Arken Space backups

Status: the local backup/restore harness is being prepared. Do not upload credentials to Git or send them in chat.

## What to create

Use a private Yandex Object Storage bucket, a dedicated service account and one static access key. The bucket stores an encrypted restic repository outside the application VM.

Recommended names:

- bucket: **arken-space-backups-&lt;unique-suffix&gt;**;
- service account: **arken-space-backup**;
- restic path: **s3:https://storage.yandexcloud.net/&lt;bucket&gt;/arken-space**.

## 1. Create the bucket

1. Open the Yandex Cloud management console and select the folder containing the Arken Space VM.
2. Open **Object Storage** and click **Create bucket**.
3. Enter a globally unique lowercase name containing letters, digits and hyphens. Do not use dots.
4. Set the maximum size to **20 GB**. This is a safety ceiling, not reserved or prepaid capacity.
5. Set all three public-access options to **With authorization**:
   - object read;
   - object list;
   - bucket settings read.
6. Select **Standard** storage.
7. Leave KMS encryption unset for this first gate. Restic encrypts data on the VM before upload.
8. Leave versioning and object lock disabled. The configured restic retention runs **forget --prune**; storage-level retained versions would keep deleted packs and increase cost.
9. Create the bucket.

Yandex instructions: [create a bucket](https://yandex.cloud/ru/docs/storage/operations/buckets/create).

## 2. Create the service account

1. In the same folder, open **Identity and Access Management**.
2. Open **Service accounts**.
3. Click **Create service account**.
4. Name it **arken-space-backup**.
5. Do not assign a folder-wide primitive role.

Yandex instructions: [create a service account](https://yandex.cloud/ru/docs/iam/operations/sa/create).

## 3. Grant access only to this bucket

1. Return to **Object Storage** and open the backup bucket.
2. Open **Security** → **Access bindings**.
3. Click **Assign roles** and select **arken-space-backup**.
4. Add the **storage.editor** role.
5. Save.

The role is intentionally scoped to one bucket. Restic needs list, read, upload and delete-object permissions because retention uses pruning. Do not grant **admin** or a folder-wide **editor** role.

Yandex instructions: [bucket IAM access](https://yandex.cloud/ru/docs/storage/operations/buckets/iam-access) and [Object Storage roles](https://yandex.cloud/ru/docs/storage/security/).

## 4. Create and save the static access key

1. Open **Identity and Access Management** → **Service accounts**.
2. Select **arken-space-backup**.
3. Click **Create new key** → **Create static access key**.
4. Add the description **arken-space restic backup**.
5. Save both values immediately:
   - key ID;
   - secret key.

The secret is displayed only once. Store it in a password manager. Do not paste either value into an issue, commit, project document or chat.

Yandex instructions: [manage static access keys](https://yandex.cloud/ru/docs/iam/operations/authentication/manage-access-keys).

## 5. Create the restic repository password

Create a separate random password of at least 48 characters in a password manager. This is not the Yandex secret key.

Keep two controlled copies:

- the password-manager entry, which remains available if the VM is lost;
- **/etc/arken-space/restic-password** on the server, one line, owned by root with mode **600**.

Losing this password makes the restic repository unrecoverable.

The static key configuration will live in **/etc/arken-space/restic.env**, also owned by root with mode **600**. Use **infra/backup/restic.env.example** as the template. The production application **.env** must not contain backup credentials.

## What to tell Codex

After completing the console steps, send only:

- the bucket name;
- confirmation that **arken-space-backup** has **storage.editor** on that bucket;
- confirmation that the key ID, secret key and restic password are stored safely.

Do not send the secret values. The server files can be filled with **sudoedit** during the deployment step.

## Cost estimate

Yandex currently includes, per calendar month for Standard storage:

- the first 1 GB of stored data;
- the first 10,000 PUT, POST, PATCH and LIST operations;
- the first 100,000 GET, HEAD and OPTIONS operations;
- the first 100 GB of internet egress.

DELETE operations, inbound traffic and traffic between Yandex Cloud services are not charged. The current Standard storage price above the free 1 GB is **2.376 RUB per GB-month including VAT**. See the current [Yandex Object Storage pricing](https://yandex.cloud/ru/docs/storage/pricing).

Current Arken Space source data:

- PostgreSQL: 8,844,979 bytes, about 8.43 MiB;
- media: about 6.2 MiB;
- total before restic compression/deduplication: under 15 MiB.

The present repository and daily operation count will remain far below the free tier, so the expected current cost is **0 RUB/month**.

Illustrative Standard-storage cost when the repository grows:

| Actual repository size | Approximate storage cost/month |
| ---------------------: | -----------------------------: |
|             up to 1 GB |                          0 RUB |
|                   5 GB |                       9.50 RUB |
|                  10 GB |                      21.38 RUB |
|                  20 GB |                      45.14 RUB |

These figures exclude operations above the free quotas. Restic is incremental and deduplicated, so seven daily snapshots do not normally consume seven complete copies of unchanged data.
