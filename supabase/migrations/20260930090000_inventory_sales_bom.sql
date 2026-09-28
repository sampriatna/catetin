-- ============================================================
-- NF3 Dapur — Tahap B: resep menu (BOM) + upload penjualan POS
-- * inv_menus / inv_menu_lines: menu yang dijual per outlet + bahan per 1 porsi (satuan master bahan)
-- * inv_menu_aliases: nama menu di POS (ESB dsb.) → menu resep. Satu nama POS per outlet.
-- * inv_sales_uploads / inv_sales_lines: rekap penjualan per menu (harian atau per periode)
-- * inv_stock_movements: tambah tipe 'jual' (rekap harian) & 'jual_periode' (rekap beberapa hari)
--   = qty terjual × bahan per porsi. Dipakai audit: pemakaian teori vs pemakaian aktual dari SO.
-- Data penjualan hanya dibaca owner/admin; menu & resep dibaca semua anggota.
-- ============================================================

begin;

create or replace function public.inv_norm(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g'));
$$;

create table if not exists public.inv_menus (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lokasi text not null check (lokasi in ('KBU', 'KSM', 'SMT')),
  nama text not null,
  kategori text,
  harga_jual numeric(18,2),
  catatan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_inv_menus_nama on public.inv_menus (business_id, lokasi, public.inv_norm(nama));

create table if not exists public.inv_menu_lines (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.inv_menus(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  qty numeric(18,6) not null check (qty > 0),
  qty_input numeric(18,4),
  satuan_input text,
  urut int not null default 0
);
create index if not exists idx_inv_menu_lines_menu on public.inv_menu_lines (menu_id);

create table if not exists public.inv_menu_aliases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lokasi text not null check (lokasi in ('KBU', 'KSM', 'SMT')),
  nama_pos text not null,
  nama_norm text not null,
  menu_id uuid references public.inv_menus(id) on delete set null,
  abaikan boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, lokasi, nama_norm)
);

create table if not exists public.inv_sales_uploads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sumber text not null default 'esb',
  nama_file text,
  dari date not null,
  sampai date not null check (sampai >= dari),
  lokasi text[] not null default '{}',
  -- true = semua baris punya tanggal (rekap harian) → bisa dipakai audit per SO.
  per_hari boolean not null default false,
  baris int not null default 0,
  total_qty numeric(18,2) not null default 0,
  total_omset numeric(18,2) not null default 0,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.inv_sales_lines (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.inv_sales_uploads(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  lokasi text not null check (lokasi in ('KBU', 'KSM', 'SMT')),
  -- Rekap harian: dari = sampai = tanggal. Rekap periode: tanggal = sampai.
  tanggal date not null,
  dari date not null,
  sampai date not null,
  nama_pos text not null,
  nama_norm text not null,
  kategori text,
  qty numeric(18,2) not null,
  omset numeric(18,2) not null default 0
);
create index if not exists idx_inv_sales_lines_lookup on public.inv_sales_lines (business_id, lokasi, tanggal);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.inv_menus enable row level security;
alter table public.inv_menu_lines enable row level security;
alter table public.inv_menu_aliases enable row level security;
alter table public.inv_sales_uploads enable row level security;
alter table public.inv_sales_lines enable row level security;

drop policy if exists inv_menus_select on public.inv_menus;
create policy inv_menus_select on public.inv_menus
  for select using (public.is_business_member(business_id));
drop policy if exists inv_menus_write on public.inv_menus;
create policy inv_menus_write on public.inv_menus
  for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (public.business_role(business_id) in ('owner', 'admin', 'purchasing'));

drop policy if exists inv_menu_lines_select on public.inv_menu_lines;
create policy inv_menu_lines_select on public.inv_menu_lines
  for select using (public.is_business_member(business_id));
drop policy if exists inv_menu_lines_write on public.inv_menu_lines;
create policy inv_menu_lines_write on public.inv_menu_lines
  for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (
    public.business_role(business_id) in ('owner', 'admin', 'purchasing')
    and exists (select 1 from public.inv_menus m where m.id = menu_id and m.business_id = inv_menu_lines.business_id)
    and exists (select 1 from public.inv_items i where i.id = item_id and i.business_id = inv_menu_lines.business_id));

drop policy if exists inv_menu_aliases_select on public.inv_menu_aliases;
create policy inv_menu_aliases_select on public.inv_menu_aliases
  for select using (public.is_business_member(business_id));
drop policy if exists inv_menu_aliases_write on public.inv_menu_aliases;
create policy inv_menu_aliases_write on public.inv_menu_aliases
  for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (
    public.business_role(business_id) in ('owner', 'admin', 'purchasing')
    and (menu_id is null or exists (select 1 from public.inv_menus m where m.id = menu_id and m.business_id = inv_menu_aliases.business_id)));

-- Penjualan: baca owner/admin; tulis hanya lewat RPC; hapus upload owner/admin.
drop policy if exists inv_sales_uploads_select on public.inv_sales_uploads;
create policy inv_sales_uploads_select on public.inv_sales_uploads
  for select using (public.business_role(business_id) in ('owner', 'admin'));
drop policy if exists inv_sales_uploads_delete on public.inv_sales_uploads;
create policy inv_sales_uploads_delete on public.inv_sales_uploads
  for delete using (public.business_role(business_id) in ('owner', 'admin'));
drop policy if exists inv_sales_lines_select on public.inv_sales_lines;
create policy inv_sales_lines_select on public.inv_sales_lines
  for select using (public.business_role(business_id) in ('owner', 'admin'));

-- ── RPC simpan upload penjualan ─────────────────────────────
-- p_upload: {sumber, nama_file, dari, sampai, created_by_name}
-- p_lines: [{lokasi, tanggal?, nama_pos, kategori, qty, omset}]
-- Data lama outlet yang sama di dalam periode ini diganti (upload ulang = koreksi).
create or replace function public.inv_sales_save(p_business uuid, p_upload jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.business_role(p_business);
  v_dari date := (p_upload->>'dari')::date;
  v_sampai date := (p_upload->>'sampai')::date;
  v_id uuid;
  v_lokasi text[];
  v_line jsonb;
  v_lok text;
  v_tgl date;
  v_qty numeric;
  v_nama text;
  v_n int := 0;
  v_tq numeric := 0;
  v_to numeric := 0;
  v_replaced int := 0;
  v_tanpa_tgl int := 0;
begin
  if coalesce(v_role, '') not in ('owner', 'admin') then
    raise exception 'hanya owner/admin yang boleh upload penjualan';
  end if;
  if v_dari is null or v_sampai is null or v_sampai < v_dari then
    raise exception 'periode tidak valid';
  end if;
  if v_sampai - v_dari > 62 then
    raise exception 'periode maksimal 2 bulan per upload';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'file tidak berisi baris penjualan';
  end if;

  select coalesce(array_agg(distinct upper(x->>'lokasi')), '{}') into v_lokasi
  from jsonb_array_elements(p_lines) x;
  if exists (select 1 from unnest(v_lokasi) l where l not in ('KBU', 'KSM', 'SMT')) then
    raise exception 'outlet tidak dikenal di file';
  end if;

  -- Rekap lama yang hanya sebagian masuk periode baru tidak dihapus diam-diam: minta hapus manual dulu.
  if exists (
    select 1 from public.inv_sales_lines s
    where s.business_id = p_business and s.lokasi = any(v_lokasi)
      and s.dari <= v_sampai and s.sampai >= v_dari
      and (s.dari < v_dari or s.sampai > v_sampai)
  ) then
    raise exception 'sudah ada rekap penjualan yang periodenya bertumpuk sebagian (mis. rekap mingguan). Hapus upload lama itu dulu di Riwayat upload, atau upload dengan periode yang mencakup seluruhnya';
  end if;

  -- Ganti data lama di dalam periode yang sama untuk outlet yang sama (upload ulang = koreksi).
  delete from public.inv_sales_lines s
  where s.business_id = p_business and s.lokasi = any(v_lokasi)
    and s.dari <= v_sampai and s.sampai >= v_dari;
  get diagnostics v_replaced = row_count;
  delete from public.inv_sales_uploads u
  where u.business_id = p_business
    and not exists (select 1 from public.inv_sales_lines s where s.upload_id = u.id);

  insert into public.inv_sales_uploads (business_id, sumber, nama_file, dari, sampai, lokasi, created_by_name)
  values (p_business, coalesce(nullif(p_upload->>'sumber', ''), 'esb'), nullif(p_upload->>'nama_file', ''),
          v_dari, v_sampai, v_lokasi, nullif(p_upload->>'created_by_name', ''))
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_lok := upper(v_line->>'lokasi');
    v_nama := btrim(coalesce(v_line->>'nama_pos', ''));
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_tgl := nullif(v_line->>'tanggal', '')::date;
    if v_nama = '' or v_qty = 0 then
      continue;
    end if;
    if v_tgl is null then
      v_tanpa_tgl := v_tanpa_tgl + 1;
    end if;
    if v_tgl is not null and (v_tgl < v_dari or v_tgl > v_sampai) then
      raise exception 'tanggal % di luar periode', v_tgl;
    end if;
    insert into public.inv_sales_lines (upload_id, business_id, lokasi, tanggal, dari, sampai, nama_pos, nama_norm, kategori, qty, omset)
    values (v_id, p_business, v_lok, coalesce(v_tgl, v_sampai), coalesce(v_tgl, v_dari), coalesce(v_tgl, v_sampai),
            v_nama, public.inv_norm(v_nama), nullif(v_line->>'kategori', ''), v_qty, coalesce((v_line->>'omset')::numeric, 0));
    insert into public.inv_menu_aliases (business_id, lokasi, nama_pos, nama_norm)
    values (p_business, v_lok, v_nama, public.inv_norm(v_nama))
    on conflict (business_id, lokasi, nama_norm) do nothing;
    v_n := v_n + 1;
    v_tq := v_tq + v_qty;
    v_to := v_to + coalesce((v_line->>'omset')::numeric, 0);
  end loop;

  if v_n = 0 then
    raise exception 'file tidak berisi baris penjualan';
  end if;
  update public.inv_sales_uploads set baris = v_n, total_qty = v_tq, total_omset = v_to, per_hari = (v_tanpa_tgl = 0)
  where id = v_id;
  return jsonb_build_object('id', v_id, 'baris', v_n, 'per_hari', v_tanpa_tgl = 0, 'total_qty', v_tq, 'total_omset', v_to, 'diganti', v_replaced);
end;
$$;

revoke all on function public.inv_sales_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.inv_sales_save(uuid, jsonb, jsonb) to authenticated;

-- ── Pergerakan stok + pemakaian teori dari penjualan ───────
-- 'jual' / 'jual_periode' ditaruh pukul 12.00 WIB pada tanggalnya (di antara SO kemarin malam & SO hari ini).
create or replace function public.inv_stock_movements(p_business uuid, p_from date, p_to date)
returns table (tanggal date, lokasi text, item_id uuid, tipe text, qty numeric, area text, oleh text, created_at timestamptz, ref_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select e.tanggal, e.lokasi, l.item_id,
    case e.jenis when 'so' then 'so' when 'waste' then 'waste' when 'masuk' then 'masuk'
      else case l.arah when 'masuk' then 'prod_in' else 'prod_out' end end,
    l.qty, e.area, e.created_by_name, e.created_at, e.id
  from public.inv_event_lines l
  join public.inv_events e on e.id = l.event_id
  join public.inv_items i on i.id = l.item_id
  where e.business_id = p_business and e.tanggal between p_from and p_to
    and lower(coalesce(l.satuan, i.satuan)) = lower(i.satuan)
  union all
  select (t.dikirim_at at time zone 'Asia/Jakarta')::date, t.dari, l.item_id, 'trf_out',
    l.qty_kirim * l.isi, null, t.dikirim_by_name, t.dikirim_at, t.id
  from public.inv_transfer_lines l join public.inv_transfers t on t.id = l.transfer_id
  where t.business_id = p_business and t.status in ('dikirim', 'diterima') and l.isi is not null and l.qty_kirim > 0
    and (t.dikirim_at at time zone 'Asia/Jakarta')::date between p_from and p_to
  union all
  select (t.diterima_at at time zone 'Asia/Jakarta')::date, t.ke, l.item_id, 'trf_in',
    l.qty_terima * l.isi, null, t.diterima_by_name, t.diterima_at, t.id
  from public.inv_transfer_lines l join public.inv_transfers t on t.id = l.transfer_id
  where t.business_id = p_business and t.status = 'diterima' and l.isi is not null and l.qty_terima > 0
    and (t.diterima_at at time zone 'Asia/Jakarta')::date between p_from and p_to
  union all
  select s.tanggal, s.lokasi, ml.item_id,
    case when s.dari = s.sampai then 'jual' else 'jual_periode' end,
    sum(s.qty * ml.qty), null, null,
    (s.tanggal + time '12:00') at time zone 'Asia/Jakarta', s.upload_id
  from public.inv_sales_lines s
  join public.inv_menu_aliases a on a.business_id = s.business_id and a.lokasi = s.lokasi and a.nama_norm = s.nama_norm
    and a.menu_id is not null and not a.abaikan
  join public.inv_menu_lines ml on ml.menu_id = a.menu_id
  where s.business_id = p_business and s.tanggal between p_from and p_to
  group by s.tanggal, s.lokasi, ml.item_id, s.dari = s.sampai, s.upload_id;
$$;

revoke all on function public.inv_stock_movements(uuid, date, date) from public, anon;
grant execute on function public.inv_stock_movements(uuid, date, date) to authenticated;

commit;
