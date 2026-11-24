import sys, openpyxl, glob, os, collections as C
def hdr_row(ws, key):
    for i,r in enumerate(ws.iter_rows(values_only=True),1):
        if r and r[0]=='N.': return i
for f in sorted(glob.glob(sys.argv[1]+'/*/*.xlsx')):
    if 'riferimento' in f: continue
    wb=openpyxl.load_workbook(f, data_only=True)
    s=wb['1_SERVIZI']; h=hdr_row(s,'N.')
    srv=[r for r in s.iter_rows(min_row=h+1, values_only=True) if any(v not in (None,'') for v in r[:10])]
    st=C.Counter(r[9] for r in srv); withid=sum(1 for r in srv if r[10]); named=sum(1 for r in srv if r[1])
    newsrv=[r[1] for r in srv if r[1] and not r[10]]
    corr=sum(1 for r in srv if r[3] and r[3]!='Sì')
    a=wb['2_ATTIVITA']; h=hdr_row(a,'N.')
    act=[r for r in a.iter_rows(min_row=h+1, values_only=True)]
    grp=[r for r in act if r[1] and r[0] is not None and '.' not in str(r[0]) and not r[11]]
    rows=[r for r in act if r[11] or (r[0] and '.' in str(r[0]))]
    filled=[r for r in rows if r[1]]
    stA=C.Counter(r[10] for r in filled)
    eff=sum(1 for r in filled if isinstance(r[3],(int,float)) and isinstance(r[4],(int,float)))
    newA=sum(1 for r in filled if not r[12])
    quando=C.Counter(r[2] for r in filled); ruolo=C.Counter(r[5] for r in filled)
    gg=sum(1 for r in filled if r[6] not in (None,''))
    note=sum(1 for r in filled if r[8])
    d=wb['3_DOMANDE']; h=hdr_row(d,'N.')
    dom=[r for r in d.iter_rows(min_row=h+1, values_only=True) if r[1]]
    print(f"\n### {os.path.relpath(f,sys.argv[1])}")
    print(f" SERVIZI righe={len(srv)} con_nome={named} con_ID={withid} nuovi_senza_ID={newsrv} desc_non_confermata={corr} stato={dict(st)}")
    print(f" ATTIVITA gruppi={len(grp)} righe_slot={len(rows)} compilate={len(filled)} con_ore_min_max={eff} con_gg={gg} nuove_senza_cod={newA} con_note={note}")
    print(f"   stato={dict(stA)}")
    print(f"   quando={dict(quando)}")
    print(f"   ruolo={dict(ruolo)}")
    print(f" DOMANDE {len(dom)} risposte={sum(1 for r in dom if r[2])}")
