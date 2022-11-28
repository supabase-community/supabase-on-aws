#!/bin/bash
export HOME=/tmp # so Git can write .gitconfig here
TMP_DIR=/tmp/src

GIT_EMAIL='git@lambda.amazonaws.com'
GIT_NAME='Lambda-backed custom resource'

function handler() {
  EVENT_DATA=$1
  REQUEST_TYPE=$(echo $EVENT_DATA | jq -r .RequestType)
  SOURCE_URL=$(echo $EVENT_DATA | jq -r .ResourceProperties.SourceUrl)
  #TARGET_REPO=$(echo $EVENT_DATA | jq -r .ResourceProperties.TargetRepo)
  git config --global user.email "$GIT_EMAIL"
  git config --global user.name "$GIT_NAME"
  rm -rf $TMP_DIR
  mkdir $TMP_DIR
  if test $REQUEST_TYPE = 'Create'; then
    curl -fsL $SOURCE_URL | tar -zx -C $TMP_DIR --strip-components 1
    cd $TMP_DIR
    git init --initial-branch main
    git add --all
    git commit -m "from $SOURCE_URL"
    git remote add origin $TARGET_REPO
    git push --force --quiet origin main
  elif test $REQUEST_TYPE = 'Update'; then
    git pull $TARGET_REPO $TMP_DIR
    curl -fsL $SOURCE_URL | tar -zx -C $TMP_DIR --strip-components 1
    cd $TMP_DIR
    git add --all
    git commit -m "from $SOURCE_URL"
    git push --force --quiet
  fi
  echo "Done!"
}
