import SwiftUI

/// Passwordless sign-in: email or phone → 6-digit code.
struct AuthView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var identifier = ""
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    BrandWordmark(size: 26).padding(.top, 8)
                    if let challenge = session.challenge {
                        verifyStep(challenge)
                    } else {
                        requestStep
                    }
                    if let error = session.error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(MM.Font.body(13, weight: .medium))
                            .foregroundStyle(MM.Color.errorText)
                            .accessibilityIdentifier("auth-error")
                    }
                    Text("By continuing you agree to MoneyMart's Terms and Privacy Policy. Codes expire after 5 minutes.")
                        .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                }
                .padding(20)
            }
            .mmScreen()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { session.cancelChallenge(); dismiss() }
                }
            }
            .onChange(of: session.status) { _, status in
                if status == .signedIn { dismiss() }
            }
        }
    }

    private var requestStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Sign in or create an account").font(MM.Font.display(28)).foregroundStyle(MM.Color.ink)
            Text("We'll send a one-time code to your email or phone. No password needed.")
                .font(MM.Font.body(15)).foregroundStyle(MM.Color.ink2)
            InputField(title: "Email or phone", text: $identifier, prompt: "you@example.com or +1 555 0100", keyboard: .emailAddress)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.send)
                .onSubmit(send)
                .accessibilityIdentifier("auth-identifier")
            Button(action: send) {
                if session.busy { ProgressView().tint(MM.Color.navy) } else { Text("Send code") }
            }
            .buttonStyle(.gold)
            .disabled(session.busy || identifier.isEmpty)
            .accessibilityIdentifier("auth-send")
        }
        .onAppear { focused = true }
    }

    private func verifyStep(_ challenge: SessionStore.Challenge) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Enter your code").font(MM.Font.display(28)).foregroundStyle(MM.Color.ink)
            Text("We sent a 6-digit code to \(challenge.destination).").font(MM.Font.body(15)).foregroundStyle(MM.Color.ink2)
            InputField(title: "Code", text: $code, prompt: "000000", keyboard: .numberPad)
                .textContentType(.oneTimeCode)
                .focused($focused)
                .onChange(of: code) { _, value in
                    let digits = String(value.filter(\.isNumber).prefix(6))
                    if digits != value { code = digits }
                    if digits.count == 6 { Task { await session.verify(code: digits) } }
                }
                .accessibilityIdentifier("auth-code")
            #if DEBUG
            if let dev = challenge.devCode {
                Button("Use development code \(dev)") { code = dev }.font(MM.Font.body(13)).foregroundStyle(MM.Color.green)
                    .accessibilityIdentifier("auth-devcode")
            }
            #endif
            Button {
                Task { await session.verify(code: code) }
            } label: {
                if session.busy { ProgressView().tint(MM.Color.navy) } else { Text("Verify and continue") }
            }
            .buttonStyle(.gold)
            .disabled(session.busy || code.count != 6)
            .accessibilityIdentifier("auth-verify")
            HStack {
                Button("Use a different address") { code = ""; session.cancelChallenge() }
                Spacer()
                Button("Resend") { Task { await session.requestCode(for: challenge.identifier) } }
            }
            .font(MM.Font.body(14, weight: .semibold))
        }
        .onAppear { focused = true }
    }

    private func send() {
        Task { await session.requestCode(for: identifier) }
    }
}

/// Wraps an action that needs an account: runs it when signed in, otherwise shows sign-in.
struct RequiresSignIn {
    @MainActor static func run(_ session: SessionStore, _ router: Router, _ action: () -> Void) {
        if session.isSignedIn { action() } else { router.showSignIn = true }
    }
}
