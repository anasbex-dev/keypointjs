# Keypoint Storage

The default backend is `MemoryKeypointStorage`. Pass a storage instance through the `keypointStorage` framework option to use a different backend.

```js
import { KeypointJS } from 'keypointjs';
import { FileKeypointStorage } from 'keypointjs/keypoint/storage';

const storage = new FileKeypointStorage('./data/keypoints.json');
await storage.ready;
const api = new KeypointJS({ keypointStorage: storage });
```

`FileKeypointStorage` initializes asynchronously. Await `ready` before using it directly; its public data methods also wait for initialization. A missing file is initialized as an empty store. Other read/JSON errors reject. Records are serialized as JSON and restored as `Keypoint` instances.

Storage methods are async: `set(keypoint)`, `get(keyId)`, `getBySecret(secret)`, `getByName(name)`, `getByScope(scope)`, `update(keyId, updates)`, `delete(keyId)`, `list(filter)`, `count()`, and `cleanupExpired()`. Filters accepted by `list` include `scope`, `protocol`, `expired`, and `name`. Exact matching for `getByScope` is based on indexed assigned scopes; it does not resolve inherited scopes.

The built-in file backend writes JSON and has no documented encryption, locking, transactional writes, multi-process coordination, or secret hashing. Protect the file with OS permissions and backups appropriate to your environment. For production persistence, review these limitations and use an application-controlled storage implementation if required. See [Security Best Practices](security-best-practices.md).
