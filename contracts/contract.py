from pyteal import *

# Constants
CLAIM_AMOUNT = Int(2_000)          # Regular claim amount of 0.002 Algo
FIRST_CLAIM_AMOUNT = Int(100_000)  # First claim amount of 0.1 Algo (with captcha)
BLOCK_INTERVAL = Int(10_000)       # Block interval 10,000 blocks
AFCAPTCHA_APP_ID = Int(3371668755) # AFCaptcha App ID
MIN_FEE = Int(1000)             # Minimum fee in microAlgos
MIN_BALANCE = Int(100_000)       # Minimum balance required for the contract
BOX_SIZE = Int(8)               # Box size in bytes (just to store the last block)

# Helper: target account is the sender (single-step claim)
@Subroutine(TealType.bytes)
def target_account() -> Expr:
    return Txn.sender()

# Subroutine to check if user has completed AFCaptcha in current transaction group
@Subroutine(TealType.uint64)
def has_completed_captcha_in_group() -> Expr:
    """Check if user has completed AFCaptcha in the current transaction group"""
    return Seq([
        # Must be in a group of at least 2 transactions for captcha verification
        If(Global.group_size() >= Int(2)).Then(
            # Check if first transaction in group is AFCaptcha solve
            If(And(
                Gtxn[Int(0)].type_enum() == TxnType.ApplicationCall,
                Gtxn[Int(0)].application_id() == AFCAPTCHA_APP_ID,
                Gtxn[Int(0)].application_args.length() >= Int(1),
                Gtxn[Int(0)].application_args[0] == Bytes("solve"),
                Gtxn[Int(0)].sender() == Txn.sender()
            )).Then(Int(1)).Else(Int(0))
        ).Else(Int(0))
    ])

# removed request box name; not needed in single-step flow

# Subroutine to check and create box if necessary
@Subroutine(TealType.none)
def check_and_create_box() -> Expr:
    box_name = target_account()
    return Seq([
        box_len := BoxLen(box_name),
        If(Not(box_len.hasValue()))
        .Then(
            Assert(BoxCreate(box_name, BOX_SIZE)),
            BoxPut(box_name, Itob(Int(0)))
        )
    ])

# Subroutine to get the last claim block (with safety check)
@Subroutine(TealType.uint64)
def get_last_claim_block() -> Expr:
    box_name = target_account()
    return Seq([
        box_len := BoxLen(box_name),
        If(Not(box_len.hasValue()))
        .Then(Int(0))
        .Else(
            box_value := BoxGet(box_name),
            Btoi(box_value.value())
        )
    ])

# Subroutine to update the last claim block
@Subroutine(TealType.none)
def update_last_claim_block() -> Expr:
    box_name = target_account()
    return BoxPut(box_name, Itob(Txn.first_valid()))

# Subroutine to verify claim conditions
@Subroutine(TealType.none)
def verify_claim_conditions(claim_amount: Expr) -> Expr:
    return Seq([
        Assert(
            Balance(Global.current_application_address()) >= (claim_amount),
            comment="Insufficient contract balance for claim and fees"
        ),
        Assert(
            Balance(Global.current_application_address()) >= MIN_BALANCE,
            comment="Contract must maintain minimum balance"
        ),
        Assert(
            Txn.rekey_to() == Global.zero_address(),
            comment="Rekey operations not allowed"
        ),
        Assert(
            Txn.close_remainder_to() == Global.zero_address(),
            comment="Account close operations not allowed"
        ),
        Assert(
            Txn.asset_close_to() == Global.zero_address(),
            comment="Asset close operations not allowed"
        )
    ])

# Subroutine to send payment
@Subroutine(TealType.none)
def send_algo_payment(claim_amount: Expr) -> Expr:
    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: target_account(),
            TxnField.amount: claim_amount,
            TxnField.fee: Int(0)  # inner tx fee covered by outer AppCall fee payer (LogicSig)
        }),
        InnerTxnBuilder.Submit()
    ])

# Subroutine to delete box (only creator can use)
@Subroutine(TealType.none)
def creator_delete_box() -> Expr:
    box_name = Txn.application_args[1]
    box_len = BoxLen(box_name)
    return Seq([
        Assert(
            Txn.sender() == Global.creator_address(),
            comment="Only contract creator can delete boxes"
        ),
        Assert(
            Txn.application_args.length() >= Int(2),
            comment="Box name must be provided as second argument"
        ),
        box_len,
        Assert(
            box_len.hasValue(),
            comment="Box does not exist"
        ),
        Pop(BoxDelete(box_name))
    ])

# Subroutine to delete many boxes (only creator can use, up to 8 per call)
@Subroutine(TealType.none)
def creator_delete_many() -> Expr:
    num_args = Txn.application_args.length()
    return Seq([
        Assert(Txn.sender() == Global.creator_address(), comment="Only contract creator can delete boxes"),
        Assert(num_args >= Int(2), comment="At least one box name required"),
        If(num_args >= Int(2)).Then(Seq([box_len1 := BoxLen(Txn.application_args[1]), Assert(box_len1.hasValue(), comment="Box[1] does not exist"), Pop(BoxDelete(Txn.application_args[1]))])),
        If(num_args >= Int(3)).Then(Seq([box_len2 := BoxLen(Txn.application_args[2]), Assert(box_len2.hasValue(), comment="Box[2] does not exist"), Pop(BoxDelete(Txn.application_args[2]))])),
        If(num_args >= Int(4)).Then(Seq([box_len3 := BoxLen(Txn.application_args[3]), Assert(box_len3.hasValue(), comment="Box[3] does not exist"), Pop(BoxDelete(Txn.application_args[3]))])),
        If(num_args >= Int(5)).Then(Seq([box_len4 := BoxLen(Txn.application_args[4]), Assert(box_len4.hasValue(), comment="Box[4] does not exist"), Pop(BoxDelete(Txn.application_args[4]))])),
        If(num_args >= Int(6)).Then(Seq([box_len5 := BoxLen(Txn.application_args[5]), Assert(box_len5.hasValue(), comment="Box[5] does not exist"), Pop(BoxDelete(Txn.application_args[5]))])),
        If(num_args >= Int(7)).Then(Seq([box_len6 := BoxLen(Txn.application_args[6]), Assert(box_len6.hasValue(), comment="Box[6] does not exist"), Pop(BoxDelete(Txn.application_args[6]))])),
        If(num_args >= Int(8)).Then(Seq([box_len7 := BoxLen(Txn.application_args[7]), Assert(box_len7.hasValue(), comment="Box[7] does not exist"), Pop(BoxDelete(Txn.application_args[7]))])),
        If(num_args >= Int(9)).Then(Seq([box_len8 := BoxLen(Txn.application_args[8]), Assert(box_len8.hasValue(), comment="Box[8] does not exist"), Pop(BoxDelete(Txn.application_args[8]))])),
    ])

# Subroutine to allow creator to withdraw Algos from contract to their address
@Subroutine(TealType.none)
def creator_withdraw() -> Expr:
    amount = Btoi(Txn.application_args[1])
    return Seq([
        Assert(Txn.sender() == Global.creator_address(), comment="Only creator can withdraw"),
        Assert(Txn.application_args.length() >= Int(2), comment="Amount argument required"),
        Assert(
            Balance(Global.current_application_address()) >= (amount + MIN_BALANCE),
            comment="Insufficient balance for withdrawal"
        ),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: Txn.sender(),
            TxnField.amount: amount,
            TxnField.fee: Int(0),
        }),
        InnerTxnBuilder.Submit(),
        Approve()
    ])

# Claim with captcha verification: 0.1 Algo for first claim (requires captcha in group), 0.002 Algo for regular claims

# Method to claim Algo with captcha verification for first claim
@Subroutine(TealType.none)
def claim() -> Expr:
    last_claim_block = ScratchVar(TealType.uint64)
    is_first_claim = ScratchVar(TealType.uint64)
    is_block_interval_ok = ScratchVar(TealType.uint64)
    is_new_beneficiary = ScratchVar(TealType.uint64)
    payout_amount = ScratchVar(TealType.uint64)
    user_has_captcha = ScratchVar(TealType.uint64)

    return Seq([
        # Check if user is a new beneficiary (no box AND zero balance)
        box_len_check := BoxLen(target_account()),
        box_len_check,
        is_new_beneficiary.store(
            And(
                Not(box_len_check.hasValue()),
                Balance(target_account()) == Int(0)
            )
        ),

        # Check if user has completed captcha in current group
        user_has_captcha.store(has_completed_captcha_in_group()),

        # Ensure box exists (create if necessary)
        check_and_create_box(),

        # Load last claim block
        last_claim_block.store(get_last_claim_block()),

        # First claim?
        is_first_claim.store(last_claim_block.load() == Int(0)),

        # Interval check
        is_block_interval_ok.store(Txn.first_valid() >= last_claim_block.load() + BLOCK_INTERVAL),

        # Determine payout amount based on captcha and new beneficiary status
        payout_amount.store(
            If(And(is_new_beneficiary.load() == Int(1), user_has_captcha.load() == Int(1)))
            .Then(FIRST_CLAIM_AMOUNT)  # 0.1 Algo for new users with captcha
            .Else(CLAIM_AMOUNT)        # 0.002 Algo for regular claims
        ),

        # Verify contract can cover payout
        verify_claim_conditions(payout_amount.load()),

        # For new beneficiaries, require captcha completion in transaction group
        If(is_new_beneficiary.load() == Int(1)).Then(
            Assert(
                user_has_captcha.load() == Int(1),
                comment="Captcha required for first claim - must be in transaction group"
            )
        ),

        # Enforce interval for all claims except the very first one (when box doesn't exist)
        If(is_new_beneficiary.load() == Int(1)).Then(
            # First claim ever - no interval required
            Seq([])
        ).Else(
            # All subsequent claims require interval
            Assert(is_block_interval_ok.load() == Int(1), comment="Must wait 10,000 blocks between claims")
        ),

        # Pay target and update last-claim block
        send_algo_payment(payout_amount.load()),
        update_last_claim_block()
    ])

# Main program
def approval_program() -> Expr:
    handle_creation = Seq([
        Return(Int(1))
    ])

    # Unique entrypoint: "claim" (single-step)
    on_call = Seq([
        Cond(
            [Txn.application_args[0] == Bytes("claim"), claim()],
            [Txn.application_args[0] == Bytes("delete_box"), creator_delete_box()],
            [Txn.application_args[0] == Bytes("delete_many"), creator_delete_many()],
            [Txn.application_args[0] == Bytes("withdraw"), creator_withdraw()],
        ),
        Return(Int(1))
    ])

    only_creator = Txn.sender() == Global.creator_address()

    return Cond(
        [Txn.application_id() == Int(0), handle_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(only_creator)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(only_creator)],
        [Txn.on_completion() == OnComplete.CloseOut, Return(Int(1))],
        [Txn.on_completion() == OnComplete.OptIn, Return(Int(1))],
        [Txn.on_completion() == OnComplete.NoOp, on_call],
    )

# Cleanup program
def clear_state_program() -> Expr:
    return Approve()


