/**
 * Worker for parallel Poseidon2 leaf hashing in build-cell-tree-snapshot.
 *
 * Each worker:
 *   1. Loads its own Poseidon2Hasher (each circuit execution is CPU-bound
 *      single-threaded, so parallelism only happens at the worker level).
 *   2. Receives a partition of CellEntry-shaped data (cellIdHex + districts
 *      as decimal strings + leafIndex), reconstructing bigints locally.
 *   3. Computes `leaf = hashPair(cellId, poseidon2Sponge(districts))` for
 *      each cell.
 *   4. Posts progress every PROGRESS_INTERVAL cells; posts final results
 *      as `{leafIndex, leafHashHex}` pairs.
 *
 * Why .mjs (not .ts): tsx's loader hooks don't reliably propagate to
 * worker_threads on Node 20 even with `execArgv: process.execArgv`. A
 * plain ESM file sidesteps the toolchain ambiguity — Node loads it
 * natively, no loader register needed.
 *
 * Why workers instead of just `hashPairsBatch`: the Noir ACVM `execute()`
 * call holds the event loop while it runs (synchronous WASM under an
 * async wrapper). `Promise.all(...)` on the same hasher does not actually
 * run in parallel; it just interleaves at await points that don't exist.
 * Worker threads give us real CPU parallelism across cores.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { Poseidon2Hasher } from '@voter-protocol/crypto';

const PROGRESS_INTERVAL = 5000;

async function main() {
	if (!parentPort) {
		throw new Error('_cell-tree-leaf-worker must be run as a worker_thread');
	}
	const { partition, workerId } = workerData;

	const hasher = await Poseidon2Hasher.getInstance();

	const results = new Array(partition.length);
	let processed = 0;
	let lastReport = 0;

	for (let i = 0; i < partition.length; i++) {
		const cell = partition[i];
		const districts = cell.districts.map((d) => BigInt(d));
		const districtCommitment = await hasher.poseidon2Sponge(districts);
		const cellIdBigInt = BigInt('0x' + cell.cellIdHex);
		const leafHash = await hasher.hashPair(cellIdBigInt, districtCommitment);
		results[i] = {
			leafIndex: cell.leafIndex,
			leafHashHex: leafHash.toString(16),
		};
		processed++;
		if (processed - lastReport >= PROGRESS_INTERVAL) {
			parentPort.postMessage({
				type: 'progress',
				workerId,
				delta: processed - lastReport,
			});
			lastReport = processed;
		}
	}

	if (processed > lastReport) {
		parentPort.postMessage({
			type: 'progress',
			workerId,
			delta: processed - lastReport,
		});
	}

	parentPort.postMessage({ type: 'done', workerId, results });
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	parentPort?.postMessage({ type: 'error', workerId: -1, message: msg });
	process.exit(1);
});
