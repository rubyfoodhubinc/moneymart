import SwiftUI

/// Coins, challenges, the rewards shop, credit and invites.
struct RewardsView: View {
    @State private var wallet: CoinWallet?
    @State private var referral: ReferralInfo?
    @State private var error: String?
    @State private var notice: String?
    @State private var inviteCode = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let wallet {
                    balance(wallet)
                    if let notice { Text(notice).font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.green).accessibilityIdentifier("rewards-notice") }
                    if let error { Text(error).font(MM.Font.body(13)).foregroundStyle(MM.Color.errorText) }
                    challenges(wallet)
                    shop(wallet)
                    invite
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
            }
            .padding(MM.Space.screen)
        }
        .navigationTitle("Rewards")
        .task { await load() }
        .refreshable { await load() }
        .mmScreen()
    }

    private func balance(_ w: CoinWallet) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(w.coins)").font(MM.Font.data(30)).foregroundStyle(MM.Color.gold).accessibilityIdentifier("rewards-coins")
                Text("coins").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Format.money(w.creditUSD, "USD")).font(MM.Font.data(22)).foregroundStyle(MM.Color.ink).accessibilityIdentifier("rewards-credit")
                Text("credit — use it on any unpaid order").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink2)
            }
        }
        .padding(16).mmCard()
        .overlay(alignment: .bottomLeading) {
            Text("Watch & Earn today: \(w.watchedTodayMinutes)/\(w.watchDailyCap)").font(MM.Font.body(10)).foregroundStyle(MM.Color.ink3).padding(.leading, 16).padding(.bottom, 4)
        }
    }

    private func challenges(_ w: CoinWallet) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Challenges").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
            ForEach(w.challenges) { c in
                HStack(spacing: 12) {
                    Image(systemName: c.claimed ? "checkmark.seal.fill" : c.done ? "gift.fill" : "circle.dashed").foregroundStyle(MM.Color.gold)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(c.title).font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
                        Text(c.detail).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                        ProgressView(value: Double(c.progress), total: Double(max(c.goal, 1))).tint(MM.Color.gold)
                    }
                    Spacer()
                    if c.claimed {
                        Text("Claimed").font(MM.Font.body(11, weight: .bold)).foregroundStyle(MM.Color.ink3)
                    } else if c.done {
                        Button("+\(c.coins)") { Task { await act { try await APIClient.shared.claimChallenge(c.id) } done: { String(localized: "+\(c.coins) coins") } } }
                            .buttonStyle(.goldCompact)
                            .accessibilityIdentifier("claim-\(c.id)")
                    } else {
                        Text("+\(c.coins)").font(MM.Font.data(13)).foregroundStyle(MM.Color.ink3)
                    }
                }
                .padding(12).mmCard()
            }
        }
    }

    private func shop(_ w: CoinWallet) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Rewards shop").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
            ForEach(w.rewards) { r in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.title).font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
                        Text("\(r.coins) coins").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                    }
                    Spacer()
                    Button("Redeem") { Task { await act { try await APIClient.shared.redeemReward(r.id) } done: { String(localized: "\(r.title) added") } } }
                        .buttonStyle(.goldCompact).disabled(!r.affordable)
                }
                .padding(12).mmCard()
            }
        }
    }

    @ViewBuilder
    private var invite: some View {
        if let referral {
            VStack(alignment: .leading, spacing: 10) {
                Text("Invite friends").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
                Text("When a friend you invite pays for their first order, you both get \(Format.money(referral.rewardUSD, "USD")) credit.").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                HStack {
                    Text(referral.code).font(MM.Font.data(18)).foregroundStyle(MM.Color.gold).textSelection(.enabled).accessibilityIdentifier("referral-code")
                    Spacer()
                    if let url = URL(string: referral.link) { ShareLink(item: url, message: Text("Join me on MoneyMart with my code \(referral.code)")) { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(.glassCompact) }
                }
                Text("\(referral.invited) invited · \(referral.rewarded) bought").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                if referral.invitedBy == nil {
                    HStack {
                        TextField("Got a friend’s code?", text: $inviteCode).textInputAutocapitalization(.characters).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                        Button("Use") { Task { await act { _ = try await APIClient.shared.claimReferral(code: inviteCode); return CoinsResult() } done: { String(localized: "Code added — your credit arrives with your first payment.") } } }
                            .buttonStyle(.goldCompact).disabled(inviteCode.count < 3)
                    }
                } else if let by = referral.invitedBy {
                    Text("Invited by @\(by.handle)").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                }
            }
            .padding(14).mmCard()
        }
    }

    private func load() async {
        do {
            wallet = try await APIClient.shared.coinWallet()
            referral = try? await APIClient.shared.referral()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func act(_ call: () async throws -> CoinsResult, done: () -> String) async {
        do {
            _ = try await call()
            notice = done()
            error = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// MoneyMart Protection: what is covered and the claim window for each category.
struct BuyerProtectionView: View {
    @State private var policy: BuyerProtection?

    var body: some View {
        List {
            if let policy {
                Section { Text(policy.summary).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink) }
                Section("Covered") { ForEach(policy.covered, id: \.self) { Label($0, systemImage: "checkmark.shield.fill").foregroundStyle(MM.Color.ink) } }
                Section("Not covered") { ForEach(policy.notCovered, id: \.self) { Label($0, systemImage: "xmark.circle").foregroundStyle(MM.Color.ink2) } }
                Section {
                    ForEach(policy.windows) { w in LabeledContent(w.label, value: String(localized: "\(w.days) days")) }
                } header: { Text("Claim windows") } footer: { Text(policy.windowNote) }
            } else {
                ProgressView()
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Buyer protection")
        .task { policy = try? await APIClient.shared.buyerProtection() }
        .mmScreen()
    }
}
