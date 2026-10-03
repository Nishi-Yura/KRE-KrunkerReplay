export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** timestamp <= value を満たす最後の要素の index を返す (なければ -1)。arr は timestamp 昇順 */
export function upperBoundIndex(arr, value) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].timestamp <= value) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return ans;
}

export function disposeObject(obj) {
    obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
            else o.material.dispose();
        }
        if (o.dispose && o.isInstancedMesh) o.dispose();
    });
}
