#!/bin/bash
export HOME=/tmp # so Git can write .gitconfig here
CLONE_DIR=/tmp/src

function handler() {
  EVENT_DATA=$1
  REQUEST_TYPE=$(echo $EVENT_DATA | jq -r .RequestType)
  if [[ $REQUEST_TYPE != 'Delete' ]]; then
    rm -rf $CLONE_DIR
    git clone --depth 1 $SOURCE_REPO $CLONE_DIR
    cd $CLONE_DIR
    git fetch --unshallow
    git remote add --mirror=push dest $TARGET_REPO
    git push --mirror dest
  fi
  echo "Done!"
}
