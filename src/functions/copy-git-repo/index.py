from typing import List, Any
import os
import subprocess

CLONE_DIR = '/tmp/src-repo'

PATH = os.environ['PATH']
LD_LIBRARY_PATH = os.environ['LD_LIBRARY_PATH']
AWS_REGION = os.environ['AWS_REGION']
AWS_ACCESS_KEY_ID = os.environ['AWS_ACCESS_KEY_ID']
AWS_SECRET_ACCESS_KEY = os.environ['AWS_SECRET_ACCESS_KEY']
AWS_SESSION_TOKEN = os.environ['AWS_SESSION_TOKEN']

def capture(output: bytes) -> str:
  return output.decode('utf-8').strip('\n')

def exec(command: List[str], cwd: str = '/tmp') -> str:
  print('start exec: {}'.format(' '.join(command)))
  response = subprocess.run(
    command,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    cwd=cwd,
    env={
      'HOME': '/tmp', # so Git can write .gitconfig here
      'PYTHONPATH': '/var/task/:/var/runtime',
      'PATH': f'/var/task/local/bin:/var/task/bin:{PATH}',
      'LD_LIBRARY_PATH': f'/var/task/local/lib:{LD_LIBRARY_PATH}',
      'AWS_REGION': AWS_REGION,
      'AWS_ACCESS_KEY_ID': AWS_ACCESS_KEY_ID,
      'AWS_SECRET_ACCESS_KEY': AWS_SECRET_ACCESS_KEY,
      'AWS_SESSION_TOKEN': AWS_SESSION_TOKEN,
    }
  )
  if response.returncode != 0:
    stderr = capture(response.stderr)
    print(stderr)
    print('end exec: {}'.format(' '.join(command)))
    raise Exception(stderr)
  else:
    stdout = capture(response.stdout)
    print(stdout)
    return stdout

def handler(event: dict, context: Any) -> dict:
  request_type: str = event['RequestType']
  source_repo: str = event['ResourceProperties']['SourceRepo']
  source_branch: str = event['ResourceProperties'].get('SourceBranch', 'main')
  target_repo: str = event['ResourceProperties']['TargetRepo']
  target_branch: str = event['ResourceProperties'].get('TargetBranch', 'main')
  if request_type != 'Delete':
    exec(['rm', '-rf', CLONE_DIR])
    exec(['git', 'clone', '--depth', '1', '-b', source_branch, source_repo, CLONE_DIR])
    exec(['git', 'fetch', '--unshallow'], CLONE_DIR)
    exec(['git', 'checkout', '-b', 'local_tmp'], CLONE_DIR)
    exec(['git', 'remote', 'add', 'dest', target_repo], CLONE_DIR)
    exec(['git', 'push', '--force', 'dest', f'local_tmp:{target_branch}'], CLONE_DIR)
  return {}