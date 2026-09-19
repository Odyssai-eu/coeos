#!/bin/bash
# Provisionne un hote Debian 13 pour CoeOS — staging (nautilus) ET VPS OVH.
# Ecrit une fois, joue deux fois : le staging LAN est la repetition generale
# de S2.1. Idempotent ; relancable sans degat.
#
# Usage (en root ou via sudo) :
#   bash provision-debian.sh staging   # ouvre 22 + 4600 (staging LAN)
#   bash provision-debian.sh vps       # ouvre 22 + 443 (prod OVH)
set -eu

PROFILE="${1:?usage: provision-debian.sh staging|vps}"
case "$PROFILE" in
  staging) PORTS="22 4600" ;;
  vps)     PORTS="22 443" ;;
  *) echo "profil inconnu: $PROFILE"; exit 1 ;;
esac
DEPLOY_USER="${DEPLOY_USER:-coeos}"

export DEBIAN_FRONTEND=noninteractive

echo "== [1/7] base systeme =="
apt-get update -q
apt-get -yq upgrade
apt-get -yq install ca-certificates curl gnupg ufw fail2ban unattended-upgrades
timedatectl set-timezone Europe/Brussels || true

echo "== [2/7] Docker CE (repo officiel, compose + buildx inclus) =="
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get -yq install docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"
systemctl enable --now docker

echo "== [3/7] pare-feu (profil: $PROFILE -> ports $PORTS) =="
ufw default deny incoming
ufw default allow outgoing
for p in $PORTS; do ufw allow "$p/tcp"; done
ufw --force enable

echo "== [4/7] fail2ban (jail sshd par defaut) =="
systemctl enable --now fail2ban

echo "== [5/7] mises a jour de securite automatiques =="
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "== [6/7] durcissement sshd (cle uniquement) =="
# Drop-in : ne s'applique que si une cle fonctionne DEJA — verifier avant de
# jouer ce script, sinon on se ferme la porte.
cat > /etc/ssh/sshd_config.d/90-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 4
EOF
systemctl reload ssh

echo "== [7/7] etat final =="
docker --version
docker compose version
docker buildx version
ufw status | head -8
fail2ban-client status sshd 2>/dev/null | head -4 || true
echo "OK -> $(hostname) provisionne (profil $PROFILE)"
