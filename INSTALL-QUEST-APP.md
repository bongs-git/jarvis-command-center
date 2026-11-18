# Installing Jarvis as a Quest app

You don't have to install anything. The website works in the Quest **Browser**: open it and tap **Enter Mixed Reality**. The installed app adds a Jarvis icon to your Quest library and opens straight into mixed reality.

## 1. One-time GitHub setup (on your phone or computer)

The build lives in the **bongs-git.github.io** repo, next to the verification file.

1. In **bongs-git.github.io**, go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `QUEST_KEYSTORE_PASSWORD`. Value: the signing password Claude gave you. Save.
3. In that repo, go to **Actions → Build Quest app → Run workflow**.

The build takes about 5–10 minutes. When it finishes, the APK is attached to the **quest-app** release:
`https://github.com/bongs-git/bongs-git.github.io/releases/download/quest-app/jarvis-quest.apk`

The app proves it belongs to this website by checking `https://<your-username>.github.io/.well-known/assetlinks.json`. If this repo isn't named `<your-username>.github.io`, that file lives in a separate `<your-username>.github.io` repo.

## 2. Turn on developer mode (one time)

1. In the **Meta Horizon** app on your phone, go to **Devices → your headset → Headset settings → Developer mode**, and turn it on. If you're asked to, create a free developer organization at developers.meta.com.
2. Restart the headset.

## 3. Install the APK

Use either option:

- **SideQuest** (easiest): install SideQuest on your computer, plug in the Quest with a USB-C cable, allow USB debugging in the headset, and drag `jarvis-quest.apk` onto SideQuest.
- **adb**: `adb install -r jarvis-quest.apk`

On the Quest, open **Library → Unknown Sources → Jarvis**.

## Updating

The app loads the live website every time it opens, so changes to the site show up without reinstalling. To rebuild the APK, run the workflow again. Each build gets a higher version number and installs over the old one.
