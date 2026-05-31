import sys
import pikepdf

input_path = sys.argv[1]
output_path = sys.argv[2]
password = sys.argv[3] if len(sys.argv) > 3 else ''

try:
    with pikepdf.open(input_path, password=password) as pdf:
        pdf.save(output_path)
    print("ok")
except pikepdf.PasswordError:
    print("wrong_password")
    sys.exit(1)
except Exception as e:
    print(f"error: {e}")
    sys.exit(2)
