# Copies the exe's (billerpe-local-exe) controllers the POS App reuses into
# appv1/exe/, rewriting their requires to the cloud's modules. Re-run after
# the exe changes one of these files, so Plan 1 and Plan 2 keep one set of
# rules:  python scripts/vendor-exe-for-appv1.py
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
CLOUD = os.path.dirname(HERE)
EXE = os.path.join(os.path.dirname(CLOUD), "billerpe-local-exe")
OUT = os.path.join(CLOUD, "appv1", "exe")
FILES = {
    "controller": ["cashSession", "customer", "menu", "menuCatalog", "variant", "addon", "tax", "paymentMode", "promoCode",
                   "kitchen", "billChargeRule", "rolePermissionDefault", "user", "expense", "purchaseOrder", "stock",
                   "wastage", "recipes", "semiFinishedItems"],
    "services": ["supplierPayments", "stockMovements"],
    "helpers": ["ownerAccount"],
    "utils": ["dateUtils", "businessDate"],
}
REWRITE = [
    (r'require\("\.\./responce/res"\)', 'require("../../../responce/res")'),
    (r'require\("\.\./constant/([^"]+)"\)', r'require("../../../constant/\1")'),
    (r'require\("\.\./connection/connect"\)', 'require("../../../connection/connect")'),
    (r'require\("\.\./connection/socket"\)', 'require("../socketShim")'),
    (r'require\("\.\./utils/logger"\)', 'require("../../../utils/logger")'),
    (r'require\("\.\./services/stockLedger"\)', 'require("../../engine/stockLedger")'),
    (r'require\("\./stockLedger"\)', 'require("../../engine/stockLedger")'),
]
HEADER = "// COPY of billerpe-local-exe/{path} for the POS App (Plan 2) -\n// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the\n// exe's file and re-run the script, so both plans keep the same rules.\n\n"
for folder, names in FILES.items():
    os.makedirs(os.path.join(OUT, folder), exist_ok=True)
    for n in names:
        src = os.path.join(EXE, folder, n + ".js")
        s = open(src, encoding="utf-8").read()
        for a, b in REWRITE:
            s = re.sub(a, b, s)
        left = [m for m in re.findall(r'require\("(\.\.?/[^"]+)"\)', s)
                if not m.startswith("../../") and m not in ("../model", "../socketShim") and not re.match(r'\.\./(utils|helpers|services)/', m) and not m.startswith("./")]
        if left:
            print(f"UNMAPPED in {folder}/{n}: {left}"); sys.exit(1)
        open(os.path.join(OUT, folder, n + ".js"), "w", encoding="utf-8", newline="\n").write(HEADER.format(path=f"{folder}/{n}.js") + s)
        print("copied", f"{folder}/{n}.js")
