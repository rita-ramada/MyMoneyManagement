import type { BankProfile, CommitRow, ImportPreview as Preview } from '@mmm/shared/src/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ProfileInput } from '../api';
import ColumnMapper, { defaultProfile, isProfileComplete } from '../components/ColumnMapper';
import ImportPreview from '../components/ImportPreview';
import { formatEuros } from '../format';
import { ErrorText, useInvalidate } from './Settings';

export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function stripId(p: BankProfile): ProfileInput {
  const { id: _id, ...rest } = p;
  return rest;
}

/** Raw cells + a live parsed sample while the user maps columns. */
function Mapper({ accountId, fileBase64, initial, onSaved }: {
  accountId: number; fileBase64: string; initial: ProfileInput; onSaved: (p: BankProfile) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [cells, setCells] = useState<string[][]>([]);
  const [sample, setSample] = useState<Preview | null>(null);
  const invalidate = useInvalidate();

  useEffect(() => {
    let live = true;
    api.importColumns({ fileBase64, delimiter: draft.delimiter, skipRows: draft.skipRows })
      .then((r) => { if (live) setCells(r.cells); })
      .catch(() => { if (live) setCells([]); });
    return () => { live = false; };
  }, [fileBase64, draft.delimiter, draft.skipRows]);

  useEffect(() => {
    if (!isProfileComplete({ ...draft, name: draft.name || 'draft' })) { setSample(null); return; }
    let live = true;
    const t = setTimeout(() => {
      api.importPreview({ accountId, profile: { ...draft, name: draft.name || 'draft' }, fileBase64, categorize: false })
        .then((r) => { if (live) setSample(r); })
        .catch(() => { if (live) setSample(null); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [accountId, fileBase64, draft]);

  const save = useMutation({
    mutationFn: async (p: ProfileInput) => {
      const profile = await api.createBankProfile(p);
      const account = (await api.listAccounts()).find((a) => a.id === accountId)!;
      const { id: _id, ...rest } = account;
      await api.updateAccount(accountId, { ...rest, bankProfileId: profile.id });
      return profile;
    },
    onSuccess: (profile) => { invalidate('accounts', 'bankProfiles'); onSaved(profile); },
  });

  return (
    <>
      <ColumnMapper cells={cells} initial={initial} onChange={setDraft} onSave={(p) => save.mutate(p)} saving={save.isPending} />
      <ErrorText error={save.error} />
      {sample && (
        <section>
          <h3>Sample with this mapping</h3>
          <table>
            <tbody>
              {sample.rows.slice(0, 5).map((r) => (
                <tr key={r.key}><td>{r.date}</td><td>{r.description}</td><td className="num">{formatEuros(r.amountCents)}</td></tr>
              ))}
            </tbody>
          </table>
          {sample.errors.length > 0 && <p className="muted">{sample.errors.length} line(s) could not be read with this mapping.</p>}
        </section>
      )}
    </>
  );
}

export default function Import() {
  const invalidate = useInvalidate();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const profiles = useQuery({ queryKey: ['bankProfiles'], queryFn: api.listBankProfiles });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.listCategories });
  const [accountId, setAccountId] = useState<number | null>(null);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [remap, setRemap] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ saved: number; skipped: number } | null>(null);

  const account = accounts.data?.find((a) => a.id === accountId);
  const profile = profiles.data?.find((p) => p.id === account?.bankProfileId);
  const needsMapping = !!file && !!account && (!profile || remap);

  const runPreview = useMutation({
    mutationFn: (p: ProfileInput) => api.importPreview({ accountId: accountId!, profile: p, fileBase64: file!.base64 }),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: (rows: CommitRow[]) => api.importCommit({ accountId: accountId!, fileName: file!.name, rows }),
    onSuccess: (r) => { setResult(r); setPreview(null); invalidate('transactions', 'spending', 'netWorth'); },
  });

  // Preview automatically once account, file and a saved mapping are all known.
  useEffect(() => {
    if (file && account && profile && !remap && !preview && !result && !runPreview.isPending && !runPreview.error) {
      runPreview.mutate(stripId(profile));
    }
  }, [file, account, profile, remap, preview, result, runPreview]);

  const reset = () => { setPreview(null); setResult(null); runPreview.reset(); commit.reset(); };

  return (
    <div className="page">
      <h1>Import bank CSV</h1>
      <section>
        <div className="row">
          <label>
            Account
            <select aria-label="Account" value={accountId ?? ''} onChange={(e) => { setAccountId(e.target.value ? Number(e.target.value) : null); setRemap(false); reset(); }}>
              <option value="">Choose…</option>
              {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                reset();
                setFile(f ? { name: f.name, base64: bytesToBase64(await f.arrayBuffer()) } : null);
              }}
            />
          </label>
          {profile && !remap && file && <button type="button" onClick={() => { setRemap(true); setPreview(null); }}>Change mapping</button>}
        </div>
        {accounts.data?.length === 0 && <p className="muted">Add an account in <Link to="/settings">Settings</Link> first.</p>}
        {profile && <p className="muted">Bank format: {profile.name}</p>}
      </section>

      {needsMapping && (
        <Mapper
          key={`${accountId}-${file?.name}-${remap}`}
          accountId={accountId!}
          fileBase64={file!.base64}
          initial={profile ? stripId(profile) : defaultProfile()}
          onSaved={() => { setRemap(false); setPreview(null); }}
        />
      )}

      <ErrorText error={runPreview.error ?? commit.error} />
      {runPreview.isPending && <p className="muted">Reading the file and suggesting categories…</p>}

      {preview && categories.data && (
        <ImportPreview
          key={preview.rows.map((r) => r.key).join()}
          preview={preview}
          categories={categories.data}
          onCommit={(rows) => commit.mutate(rows)}
          saving={commit.isPending}
        />
      )}

      {result && (
        <section>
          <p>Saved {result.saved} transaction(s), skipped {result.skipped}.</p>
          <Link to="/transactions">Go to transactions</Link>
        </section>
      )}
    </div>
  );
}
