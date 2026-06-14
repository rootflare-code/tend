import SwiftUI

struct SignInView: View {
    @Bindable var model: TendAppModel
    @FocusState private var focusedField: Field?

    private enum Field {
        case email
        case code
    }

    var body: some View {
        ZStack {
            TendTheme.paper.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Spacer(minLength: 44)

                    Image(systemName: "circle.hexagongrid.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(TendTheme.cobalt)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Tend")
                            .font(.system(size: 46, weight: .medium, design: .serif))
                            .foregroundStyle(TendTheme.ink)
                        Text("Review what needs your attention. Codex handles the rest when your Mac reconnects.")
                            .font(.title3)
                            .foregroundStyle(TendTheme.secondaryInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        if model.authState == .codeSent {
                            codeField
                        } else {
                            emailField
                        }
                    }
                    .padding(22)
                    .tendCardSurface()

                    Text("The phone receives review-safe card projections only. Connector credentials and unfiltered Chronicle material stay off-device.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 22)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .onAppear {
            focusedField = model.authState == .codeSent ? .code : .email
        }
        .onChange(of: model.authState) { _, state in
            focusedField = state == .codeSent ? .code : .email
        }
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sign in with email")
                .font(.headline)
            TextField("you@example.com", text: $model.email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focusedField, equals: .email)
                .submitLabel(.continue)
                .onSubmit {
                    Task { await model.requestCode() }
                }
                .padding(14)
                .background(TendTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Button {
                Task { await model.requestCode() }
            } label: {
                submitLabel("Email me a code")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isSubmitting)
        }
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Check your email")
                .font(.headline)
            Text("Enter the six-digit code sent to \(model.email).")
                .foregroundStyle(.secondary)
            TextField("000000", text: $model.code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .focused($focusedField, equals: .code)
                .font(.system(.title2, design: .monospaced, weight: .semibold))
                .padding(14)
                .background(TendTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityLabel("Six-digit email code")
            Button {
                Task { await model.verifyCode() }
            } label: {
                submitLabel("Open Tend")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isSubmitting)

            Button("Use a different email") {
                model.authState = .signedOut
                model.code = ""
            }
            .font(.subheadline.weight(.medium))
        }
    }

    private func submitLabel(_ title: String) -> some View {
        HStack {
            if model.isSubmitting {
                ProgressView()
                    .tint(.white)
            }
            Text(title)
                .frame(maxWidth: .infinity)
        }
    }
}
